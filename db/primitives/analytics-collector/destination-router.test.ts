/**
 * DestinationRouter Tests
 *
 * Comprehensive tests for the destination router including:
 * - Basic routing and fan-out
 * - Per-destination filtering and transformation
 * - Retry logic with exponential backoff
 * - Circuit breaker pattern
 * - Error handling and callbacks
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  DestinationRouter,
  createDestinationRouter,
  type DestinationConfig,
  type AnalyticsEvent,
  type EventFilter,
  type EventTransform,
  // Filter helpers
  filterByEventType,
  filterByProperty,
  filterByUser,
  excludeEvents,
  includeEvents,
  andFilters,
  orFilters,
  notFilter,
  // Transform helpers
  addProperties,
  removeProperties,
  renameProperties,
  maskProperties,
  maskEventFields,
  chainTransforms,
} from './destination-router'

// ============================================================================
// TEST HELPERS
// ============================================================================

function createTestEvent(overrides: Partial<AnalyticsEvent> = {}): AnalyticsEvent {
  return {
    type: 'track',
    messageId: `msg_${Math.random().toString(36).slice(2)}`,
    timestamp: new Date().toISOString(),
    userId: 'user_123',
    event: 'Test Event',
    properties: { key: 'value' },
    ...overrides,
  }
}

function createMockDestination(
  name: string,
  options: {
    delay?: number
    failTimes?: number
    failWithError?: Error
  } = {}
): DestinationConfig & { events: AnalyticsEvent[] } {
  const events: AnalyticsEvent[] = []
  let failCount = 0

  return {
    name,
    events,
    send: async (batch) => {
      if (options.delay) {
        await new Promise((resolve) => setTimeout(resolve, options.delay))
      }

      if (options.failTimes !== undefined && failCount < options.failTimes) {
        failCount++
        throw options.failWithError ?? new Error(`${name} failed (attempt ${failCount})`)
      }

      events.push(...batch)
    },
  }
}

// ============================================================================
// BASIC ROUTING TESTS
// ============================================================================

describe('DestinationRouter', () => {
  describe('creation', () => {
    it('should create with default options', () => {
      const router = createDestinationRouter()
      expect(router).toBeDefined()
      expect(router.getDestinationNames()).toHaveLength(0)
    })

    it('should create with custom options', () => {
      const router = createDestinationRouter({
        parallel: false,
        continueOnError: false,
        defaultRetry: {
          maxAttempts: 5,
          initialDelayMs: 200,
        },
      })
      expect(router).toBeDefined()
    })
  })

  describe('destination management', () => {
    let router: DestinationRouter

    beforeEach(() => {
      router = createDestinationRouter()
    })

    it('should add a destination', () => {
      const dest = createMockDestination('test')
      router.addDestination(dest)
      expect(router.hasDestination('test')).toBe(true)
      expect(router.getDestinationNames()).toContain('test')
    })

    it('should reject duplicate destination names', () => {
      router.addDestination(createMockDestination('test'))
      expect(() => router.addDestination(createMockDestination('test'))).toThrow(
        'Destination "test" is already registered'
      )
    })

    it('should remove a destination', () => {
      router.addDestination(createMockDestination('test'))
      expect(router.removeDestination('test')).toBe(true)
      expect(router.hasDestination('test')).toBe(false)
    })

    it('should return false when removing non-existent destination', () => {
      expect(router.removeDestination('nonexistent')).toBe(false)
    })

    it('should get destination config', () => {
      const dest = createMockDestination('test')
      router.addDestination(dest)
      const config = router.getDestination('test')
      expect(config?.name).toBe('test')
    })

    it('should enable and disable destinations', () => {
      router.addDestination(createMockDestination('test'))
      router.disableDestination('test')
      const stats = router.getStats('test')
      expect(stats?.enabled).toBe(false)

      router.enableDestination('test')
      const statsAfter = router.getStats('test')
      expect(statsAfter?.enabled).toBe(true)
    })
  })

  describe('basic routing', () => {
    let router: DestinationRouter
    let dest1: ReturnType<typeof createMockDestination>
    let dest2: ReturnType<typeof createMockDestination>

    beforeEach(() => {
      router = createDestinationRouter()
      dest1 = createMockDestination('dest1')
      dest2 = createMockDestination('dest2')
      router.addDestination(dest1)
      router.addDestination(dest2)
    })

    it('should route events to all destinations', async () => {
      const events = [createTestEvent(), createTestEvent()]
      const result = await router.route(events)

      expect(result.success).toBe(true)
      expect(result.totalEvents).toBe(2)
      expect(result.destinations).toHaveLength(2)
      expect(dest1.events).toHaveLength(2)
      expect(dest2.events).toHaveLength(2)
    })

    it('should handle empty event array', async () => {
      const result = await router.route([])
      expect(result.success).toBe(true)
      expect(result.totalEvents).toBe(0)
      expect(result.destinations).toHaveLength(0)
    })

    it('should not route to disabled destinations', async () => {
      router.disableDestination('dest2')
      const events = [createTestEvent()]
      await router.route(events)

      expect(dest1.events).toHaveLength(1)
      expect(dest2.events).toHaveLength(0)
    })

    it('should respect destination priority', async () => {
      const router2 = createDestinationRouter({ parallel: false })
      const order: string[] = []

      router2.addDestination({
        name: 'low',
        priority: 1,
        send: async () => {
          order.push('low')
        },
      })
      router2.addDestination({
        name: 'high',
        priority: 10,
        send: async () => {
          order.push('high')
        },
      })
      router2.addDestination({
        name: 'medium',
        priority: 5,
        send: async () => {
          order.push('medium')
        },
      })

      await router2.route([createTestEvent()])
      expect(order).toEqual(['high', 'medium', 'low'])
    })
  })

  describe('parallel vs sequential routing', () => {
    it('should route in parallel by default', async () => {
      const router = createDestinationRouter({ parallel: true })
      const times: number[] = []
      const start = Date.now()

      router.addDestination({
        name: 'slow1',
        send: async () => {
          await new Promise((r) => setTimeout(r, 50))
          times.push(Date.now() - start)
        },
      })
      router.addDestination({
        name: 'slow2',
        send: async () => {
          await new Promise((r) => setTimeout(r, 50))
          times.push(Date.now() - start)
        },
      })

      await router.route([createTestEvent()])

      // Both should complete around the same time if parallel
      expect(Math.abs(times[0] - times[1])).toBeLessThan(30)
    })

    it('should route sequentially when parallel=false', async () => {
      const router = createDestinationRouter({ parallel: false })
      const times: number[] = []
      const start = Date.now()

      router.addDestination({
        name: 'slow1',
        send: async () => {
          await new Promise((r) => setTimeout(r, 50))
          times.push(Date.now() - start)
        },
      })
      router.addDestination({
        name: 'slow2',
        send: async () => {
          await new Promise((r) => setTimeout(r, 50))
          times.push(Date.now() - start)
        },
      })

      await router.route([createTestEvent()])

      // Sequential: second should finish ~50ms after first
      expect(times[1] - times[0]).toBeGreaterThanOrEqual(40)
    })
  })
})

// ============================================================================
// FILTERING TESTS
// ============================================================================

describe('Event Filtering', () => {
  let router: DestinationRouter
  let dest: ReturnType<typeof createMockDestination>

  beforeEach(() => {
    router = createDestinationRouter()
    dest = createMockDestination('filtered')
  })

  describe('event type filtering', () => {
    it('should filter by event types', async () => {
      dest.eventTypes = ['track', 'identify']
      router.addDestination(dest)

      const events = [
        createTestEvent({ type: 'track' }),
        createTestEvent({ type: 'page' }),
        createTestEvent({ type: 'identify' }),
        createTestEvent({ type: 'screen' }),
      ]

      const result = await router.route(events)
      expect(dest.events).toHaveLength(2)
      expect(dest.events.map((e) => e.type)).toEqual(['track', 'identify'])
      expect(result.destinations[0].filtered).toBe(2)
    })
  })

  describe('custom filter', () => {
    it('should apply custom filter function', async () => {
      dest.filter = (event) => (event.properties?.amount as number) > 100
      router.addDestination(dest)

      const events = [
        createTestEvent({ properties: { amount: 50 } }),
        createTestEvent({ properties: { amount: 150 } }),
        createTestEvent({ properties: { amount: 200 } }),
      ]

      await router.route(events)
      expect(dest.events).toHaveLength(2)
    })

    it('should count filtered events correctly', async () => {
      dest.filter = () => false // Filter all events
      router.addDestination(dest)

      const events = [createTestEvent(), createTestEvent(), createTestEvent()]
      const result = await router.route(events)

      expect(dest.events).toHaveLength(0)
      expect(result.destinations[0].filtered).toBe(3)
      expect(result.destinations[0].success).toBe(true)
    })
  })

  describe('filter helpers', () => {
    it('filterByEventType should match event types', () => {
      const filter = filterByEventType('track', 'page')
      expect(filter(createTestEvent({ type: 'track' }))).toBe(true)
      expect(filter(createTestEvent({ type: 'page' }))).toBe(true)
      expect(filter(createTestEvent({ type: 'identify' }))).toBe(false)
    })

    it('filterByProperty should match properties', () => {
      const filter = filterByProperty('plan', (v) => v === 'premium')
      expect(filter(createTestEvent({ properties: { plan: 'premium' } }))).toBe(true)
      expect(filter(createTestEvent({ properties: { plan: 'free' } }))).toBe(false)
    })

    it('filterByUser should match users', () => {
      const filter = filterByUser('user_1', 'user_2')
      expect(filter(createTestEvent({ userId: 'user_1' }))).toBe(true)
      expect(filter(createTestEvent({ anonymousId: 'user_2' }))).toBe(true)
      expect(filter(createTestEvent({ userId: 'user_3' }))).toBe(false)
    })

    it('excludeEvents should exclude by name', () => {
      const filter = excludeEvents('Sensitive Event')
      expect(filter(createTestEvent({ event: 'Normal Event' }))).toBe(true)
      expect(filter(createTestEvent({ event: 'Sensitive Event' }))).toBe(false)
    })

    it('includeEvents should include by name', () => {
      const filter = includeEvents('Important Event')
      expect(filter(createTestEvent({ event: 'Important Event' }))).toBe(true)
      expect(filter(createTestEvent({ event: 'Other Event' }))).toBe(false)
    })

    it('andFilters should combine with AND', () => {
      const filter = andFilters(
        filterByEventType('track'),
        filterByProperty('important', (v) => v === true)
      )
      expect(
        filter(createTestEvent({ type: 'track', properties: { important: true } }))
      ).toBe(true)
      expect(
        filter(createTestEvent({ type: 'track', properties: { important: false } }))
      ).toBe(false)
      expect(
        filter(createTestEvent({ type: 'page', properties: { important: true } }))
      ).toBe(false)
    })

    it('orFilters should combine with OR', () => {
      const filter = orFilters(
        filterByEventType('track'),
        filterByEventType('page')
      )
      expect(filter(createTestEvent({ type: 'track' }))).toBe(true)
      expect(filter(createTestEvent({ type: 'page' }))).toBe(true)
      expect(filter(createTestEvent({ type: 'identify' }))).toBe(false)
    })

    it('notFilter should negate', () => {
      const filter = notFilter(filterByEventType('track'))
      expect(filter(createTestEvent({ type: 'track' }))).toBe(false)
      expect(filter(createTestEvent({ type: 'page' }))).toBe(true)
    })
  })
})

// ============================================================================
// TRANSFORMATION TESTS
// ============================================================================

describe('Event Transformation', () => {
  let router: DestinationRouter
  let dest: ReturnType<typeof createMockDestination>

  beforeEach(() => {
    router = createDestinationRouter()
    dest = createMockDestination('transformed')
  })

  describe('custom transform', () => {
    it('should apply transform to events', async () => {
      dest.transform = (event) => ({
        ...event,
        properties: {
          ...event.properties,
          transformed: true,
          destination: 'transformed',
        },
      })
      router.addDestination(dest)

      await router.route([createTestEvent()])

      expect(dest.events[0].properties).toMatchObject({
        transformed: true,
        destination: 'transformed',
      })
    })

    it('should filter events by returning null from transform', async () => {
      dest.transform = (event) => {
        if ((event.properties?.sensitive as boolean) === true) {
          return null
        }
        return event
      }
      router.addDestination(dest)

      await router.route([
        createTestEvent({ properties: { sensitive: true } }),
        createTestEvent({ properties: { sensitive: false } }),
        createTestEvent({ properties: {} }),
      ])

      expect(dest.events).toHaveLength(2)
    })
  })

  describe('transform helpers', () => {
    it('addProperties should add properties', () => {
      const transform = addProperties({ added: true, source: 'router' })
      const result = transform(createTestEvent({ properties: { existing: 1 } }))
      expect(result?.properties).toMatchObject({
        existing: 1,
        added: true,
        source: 'router',
      })
    })

    it('removeProperties should remove properties', () => {
      const transform = removeProperties('secret', 'internal')
      const result = transform(
        createTestEvent({ properties: { keep: 1, secret: 'x', internal: 'y' } })
      )
      expect(result?.properties).toEqual({ keep: 1 })
    })

    it('renameProperties should rename properties', () => {
      const transform = renameProperties({ oldName: 'newName' })
      const result = transform(
        createTestEvent({ properties: { oldName: 'value', other: 1 } })
      )
      expect(result?.properties).toEqual({ newName: 'value', other: 1 })
    })

    it('maskProperties should mask sensitive values', () => {
      const transform = maskProperties('password', 'ssn')
      const result = transform(
        createTestEvent({
          properties: { password: 'secret123', ssn: '123-45-6789', name: 'John' },
        })
      )
      expect(result?.properties).toEqual({
        password: '***MASKED***',
        ssn: '***MASKED***',
        name: 'John',
      })
    })

    it('maskEventFields should mask top-level event fields', () => {
      const transform = maskEventFields('userId', 'anonymousId')
      const result = transform(
        createTestEvent({ userId: 'user_123', anonymousId: 'anon_456' })
      )
      expect(result?.userId).toBe('***MASKED***')
      expect(result?.anonymousId).toBe('***MASKED***')
    })

    it('chainTransforms should chain multiple transforms', () => {
      const transform = chainTransforms(
        addProperties({ step1: true }),
        addProperties({ step2: true }),
        removeProperties('unwanted')
      )
      const result = transform(
        createTestEvent({ properties: { unwanted: 'x', keep: 1 } })
      )
      expect(result?.properties).toEqual({ keep: 1, step1: true, step2: true })
    })

    it('chainTransforms should stop on null', () => {
      const transform = chainTransforms(
        () => null, // This returns null
        addProperties({ shouldNotAdd: true })
      )
      const result = transform(createTestEvent())
      expect(result).toBeNull()
    })
  })
})

// ============================================================================
// RETRY LOGIC TESTS
// ============================================================================

describe('Retry Logic', () => {
  it('should retry failed sends', async () => {
    const router = createDestinationRouter({
      defaultRetry: {
        maxAttempts: 3,
        initialDelayMs: 10,
        backoffMultiplier: 2,
      },
    })

    let attempts = 0
    router.addDestination({
      name: 'flaky',
      send: async () => {
        attempts++
        if (attempts < 3) {
          throw new Error('Temporary failure')
        }
      },
    })

    const result = await router.route([createTestEvent()])

    expect(result.success).toBe(true)
    expect(attempts).toBe(3)
    expect(result.destinations[0].attempts).toBe(3)
  })

  it('should fail after max retries exhausted', async () => {
    const router = createDestinationRouter({
      defaultRetry: {
        maxAttempts: 2,
        initialDelayMs: 10,
      },
    })

    let attempts = 0
    router.addDestination({
      name: 'always-fails',
      send: async () => {
        attempts++
        throw new Error('Permanent failure')
      },
    })

    const result = await router.route([createTestEvent()])

    expect(result.success).toBe(false)
    expect(attempts).toBe(3) // 1 initial + 2 retries
    expect(result.destinations[0].success).toBe(false)
    expect(result.destinations[0].error?.message).toContain('Permanent failure')
  })

  it('should apply exponential backoff', async () => {
    const router = createDestinationRouter({
      defaultRetry: {
        maxAttempts: 3,
        initialDelayMs: 50,
        backoffMultiplier: 2,
        maxDelayMs: 1000,
        jitter: false,
      },
    })

    const delays: number[] = []
    let lastTime = Date.now()

    router.addDestination({
      name: 'timing',
      send: async () => {
        const now = Date.now()
        delays.push(now - lastTime)
        lastTime = now
        throw new Error('Fail')
      },
    })

    await router.route([createTestEvent()])

    // delays[0] is first attempt (no delay)
    // delays[1] should be ~50ms (initial delay)
    // delays[2] should be ~100ms (50 * 2)
    // delays[3] should be ~200ms (100 * 2)
    expect(delays[1]).toBeGreaterThanOrEqual(40)
    expect(delays[2]).toBeGreaterThanOrEqual(90)
    expect(delays[3]).toBeGreaterThanOrEqual(180)
  })

  it('should respect per-destination retry config', async () => {
    const router = createDestinationRouter({
      defaultRetry: { maxAttempts: 5 },
    })

    let attempts = 0
    router.addDestination({
      name: 'custom-retry',
      retry: { maxAttempts: 1 },
      send: async () => {
        attempts++
        throw new Error('Fail')
      },
    })

    await router.route([createTestEvent()])

    expect(attempts).toBe(2) // 1 initial + 1 retry
  })
})

// ============================================================================
// CIRCUIT BREAKER TESTS
// ============================================================================

describe('Circuit Breaker', () => {
  it('should open circuit after failure threshold', async () => {
    const router = createDestinationRouter({
      defaultCircuitBreaker: {
        failureThreshold: 3,
        minimumRequests: 3,
        resetTimeoutMs: 1000,
      },
      defaultRetry: { maxAttempts: 0 },
    })

    router.addDestination({
      name: 'failing',
      send: async () => {
        throw new Error('Fail')
      },
    })

    // Trigger failures to open circuit
    for (let i = 0; i < 3; i++) {
      await router.route([createTestEvent()])
    }

    const stats = router.getStats('failing')
    expect(stats?.circuitState).toBe('open')

    // Next request should be blocked by circuit breaker
    const result = await router.route([createTestEvent()])
    expect(result.destinations[0].error?.message).toContain('Circuit breaker is open')
  })

  it('should transition to half-open after reset timeout', async () => {
    vi.useFakeTimers()

    const router = createDestinationRouter({
      defaultCircuitBreaker: {
        failureThreshold: 2,
        minimumRequests: 2,
        resetTimeoutMs: 500,
      },
      defaultRetry: { maxAttempts: 0 },
    })

    router.addDestination({
      name: 'recovering',
      send: async () => {
        throw new Error('Fail')
      },
    })

    // Open the circuit
    await router.route([createTestEvent()])
    await router.route([createTestEvent()])

    let stats = router.getStats('recovering')
    expect(stats?.circuitState).toBe('open')

    // Advance past reset timeout
    vi.advanceTimersByTime(600)

    stats = router.getStats('recovering')
    expect(stats?.circuitState).toBe('half-open')

    vi.useRealTimers()
  })

  it('should close circuit on successful recovery', async () => {
    const router = createDestinationRouter({
      defaultCircuitBreaker: {
        failureThreshold: 2,
        minimumRequests: 2,
        resetTimeoutMs: 100,
      },
      defaultRetry: { maxAttempts: 0 },
    })

    let shouldFail = true
    router.addDestination({
      name: 'recovering',
      send: async () => {
        if (shouldFail) throw new Error('Fail')
      },
    })

    // Open the circuit
    await router.route([createTestEvent()])
    await router.route([createTestEvent()])

    // Wait for reset timeout
    await new Promise((r) => setTimeout(r, 150))

    // Now make it succeed
    shouldFail = false
    await router.route([createTestEvent()])

    const stats = router.getStats('recovering')
    expect(stats?.circuitState).toBe('closed')
  })

  it('should reset circuit breaker manually', async () => {
    const router = createDestinationRouter({
      defaultCircuitBreaker: {
        failureThreshold: 1,
        minimumRequests: 1,
      },
      defaultRetry: { maxAttempts: 0 },
    })

    router.addDestination({
      name: 'resettable',
      send: async () => {
        throw new Error('Fail')
      },
    })

    await router.route([createTestEvent()])

    let stats = router.getStats('resettable')
    expect(stats?.circuitState).toBe('open')

    router.resetCircuitBreaker('resettable')

    stats = router.getStats('resettable')
    expect(stats?.circuitState).toBe('closed')
  })
})

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('Error Handling', () => {
  it('should continue to other destinations on error when continueOnError=true', async () => {
    const router = createDestinationRouter({
      continueOnError: true,
      defaultRetry: { maxAttempts: 0 },
    })

    const successDest = createMockDestination('success')

    router.addDestination({
      name: 'failing',
      send: async () => {
        throw new Error('Fail')
      },
    })
    router.addDestination(successDest)

    const result = await router.route([createTestEvent()])

    expect(result.success).toBe(false) // Overall failed
    expect(successDest.events).toHaveLength(1) // But success dest received events
    expect(result.destinations.find((d) => d.destination === 'success')?.success).toBe(
      true
    )
  })

  it('should stop on first error when continueOnError=false and parallel=false', async () => {
    const router = createDestinationRouter({
      continueOnError: false,
      parallel: false,
      defaultRetry: { maxAttempts: 0 },
    })

    const secondDest = createMockDestination('second')

    router.addDestination({
      name: 'first-fails',
      priority: 10, // Higher priority, runs first
      send: async () => {
        throw new Error('First failed')
      },
    })
    router.addDestination({ ...secondDest, priority: 1 })

    await router.route([createTestEvent()])

    expect(secondDest.events).toHaveLength(0) // Never reached
  })

  it('should call per-destination onError callback', async () => {
    const router = createDestinationRouter({
      defaultRetry: { maxAttempts: 0 },
    })

    const errors: Array<{ error: Error; events: AnalyticsEvent[] }> = []

    router.addDestination({
      name: 'with-callback',
      send: async () => {
        throw new Error('Test error')
      },
      onError: (error, events) => {
        errors.push({ error, events })
      },
    })

    await router.route([createTestEvent(), createTestEvent()])

    expect(errors).toHaveLength(1)
    expect(errors[0].error.message).toBe('Test error')
    expect(errors[0].events).toHaveLength(2)
  })

  it('should call per-destination onSuccess callback', async () => {
    const router = createDestinationRouter()

    const successes: AnalyticsEvent[][] = []

    router.addDestination({
      name: 'with-callback',
      send: async () => {},
      onSuccess: (events) => {
        successes.push(events)
      },
    })

    await router.route([createTestEvent(), createTestEvent()])

    expect(successes).toHaveLength(1)
    expect(successes[0]).toHaveLength(2)
  })

  it('should call global onError callback', async () => {
    const errors: Array<{ error: Error; destination: string; events: AnalyticsEvent[] }> = []

    const router = createDestinationRouter({
      defaultRetry: { maxAttempts: 0 },
      onError: (error, destination, events) => {
        errors.push({ error, destination, events })
      },
    })

    router.addDestination({
      name: 'failing',
      send: async () => {
        throw new Error('Global error test')
      },
    })

    await router.route([createTestEvent()])

    expect(errors).toHaveLength(1)
    expect(errors[0].destination).toBe('failing')
  })

  it('should call onBeforeRoute and onAfterRoute callbacks', async () => {
    let beforeCalled = false
    let afterResults: unknown = null

    const router = createDestinationRouter({
      onBeforeRoute: () => {
        beforeCalled = true
      },
      onAfterRoute: (results) => {
        afterResults = results
      },
    })

    router.addDestination(createMockDestination('test'))

    await router.route([createTestEvent()])

    expect(beforeCalled).toBe(true)
    expect(afterResults).toBeDefined()
  })
})

// ============================================================================
// TIMEOUT TESTS
// ============================================================================

describe('Timeout', () => {
  it('should timeout slow destinations', async () => {
    const router = createDestinationRouter({
      defaultRetry: { maxAttempts: 0 },
    })

    router.addDestination({
      name: 'slow',
      timeoutMs: 50,
      send: async () => {
        await new Promise((r) => setTimeout(r, 200))
      },
    })

    const result = await router.route([createTestEvent()])

    expect(result.success).toBe(false)
    expect(result.destinations[0].error?.message).toContain('timed out')
  })
})

// ============================================================================
// BATCHING TESTS
// ============================================================================

describe('Batching', () => {
  it('should batch events according to batchSize', async () => {
    const router = createDestinationRouter()

    const batches: AnalyticsEvent[][] = []
    router.addDestination({
      name: 'batched',
      batchSize: 3,
      send: async (events) => {
        batches.push([...events])
      },
    })

    const events = Array(7)
      .fill(null)
      .map(() => createTestEvent())
    await router.route(events)

    expect(batches).toHaveLength(3) // 3 + 3 + 1
    expect(batches[0]).toHaveLength(3)
    expect(batches[1]).toHaveLength(3)
    expect(batches[2]).toHaveLength(1)
  })

  it('should not batch when batchSize is not set', async () => {
    const router = createDestinationRouter()

    const batches: AnalyticsEvent[][] = []
    router.addDestination({
      name: 'unbatched',
      send: async (events) => {
        batches.push([...events])
      },
    })

    const events = Array(10)
      .fill(null)
      .map(() => createTestEvent())
    await router.route(events)

    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(10)
  })
})

// ============================================================================
// STATISTICS TESTS
// ============================================================================

describe('Statistics', () => {
  it('should track success and failure counts', async () => {
    const router = createDestinationRouter({
      defaultRetry: { maxAttempts: 0 },
    })

    let shouldFail = false
    router.addDestination({
      name: 'tracked',
      send: async () => {
        if (shouldFail) throw new Error('Fail')
      },
    })

    await router.route([createTestEvent()])
    await router.route([createTestEvent()])

    shouldFail = true
    await router.route([createTestEvent()])

    const stats = router.getStats('tracked')
    expect(stats?.successCount).toBe(2)
    expect(stats?.failureCount).toBe(1)
  })

  it('should track filtered event counts', async () => {
    const router = createDestinationRouter()

    router.addDestination({
      name: 'filtered',
      filter: (e) => e.event === 'Important',
      send: async () => {},
    })

    await router.route([
      createTestEvent({ event: 'Important' }),
      createTestEvent({ event: 'Normal' }),
      createTestEvent({ event: 'Normal' }),
    ])

    const stats = router.getStats('filtered')
    expect(stats?.filteredCount).toBe(2)
    expect(stats?.totalEventsRouted).toBe(1)
  })

  it('should track latencies and compute average', async () => {
    const router = createDestinationRouter()

    router.addDestination({
      name: 'timed',
      send: async () => {
        await new Promise((r) => setTimeout(r, 10))
      },
    })

    await router.route([createTestEvent()])
    await router.route([createTestEvent()])

    const stats = router.getStats('timed')
    expect(stats?.averageLatencyMs).toBeGreaterThan(0)
  })

  it('should get stats for all destinations', async () => {
    const router = createDestinationRouter()

    router.addDestination(createMockDestination('dest1'))
    router.addDestination(createMockDestination('dest2'))
    router.addDestination(createMockDestination('dest3'))

    await router.route([createTestEvent()])

    const allStats = router.getAllStats()
    expect(allStats).toHaveLength(3)
    expect(allStats.map((s) => s.name).sort()).toEqual(['dest1', 'dest2', 'dest3'])
  })

  it('should track last success and failure times', async () => {
    const router = createDestinationRouter({
      defaultRetry: { maxAttempts: 0 },
    })

    let shouldFail = false
    router.addDestination({
      name: 'tracked',
      send: async () => {
        if (shouldFail) throw new Error('Fail')
      },
    })

    await router.route([createTestEvent()])
    const statsAfterSuccess = router.getStats('tracked')
    expect(statsAfterSuccess?.lastSuccessAt).toBeDefined()
    expect(statsAfterSuccess?.lastFailureAt).toBeUndefined()

    shouldFail = true
    await router.route([createTestEvent()])
    const statsAfterFailure = router.getStats('tracked')
    expect(statsAfterFailure?.lastFailureAt).toBeDefined()
    expect(statsAfterFailure?.lastError?.message).toBe('Fail')
  })
})

// ============================================================================
// MULTIPLE DESTINATIONS INTEGRATION
// ============================================================================

describe('Multiple Destinations Integration', () => {
  it('should route to different destinations with different configs', async () => {
    const router = createDestinationRouter()

    const analyticsEvents: AnalyticsEvent[] = []
    const marketingEvents: AnalyticsEvent[] = []
    const auditEvents: AnalyticsEvent[] = []

    // Analytics destination - only track events
    router.addDestination({
      name: 'analytics',
      eventTypes: ['track'],
      transform: addProperties({ source: 'analytics' }),
      send: async (events) => {
        analyticsEvents.push(...events)
      },
    })

    // Marketing destination - exclude internal events
    router.addDestination({
      name: 'marketing',
      filter: excludeEvents('Internal Action'),
      transform: maskEventFields('userId'),
      send: async (events) => {
        marketingEvents.push(...events)
      },
    })

    // Audit destination - all events, no transform
    router.addDestination({
      name: 'audit',
      send: async (events) => {
        auditEvents.push(...events)
      },
    })

    const events = [
      createTestEvent({ type: 'track', event: 'Button Clicked' }),
      createTestEvent({ type: 'track', event: 'Internal Action' }),
      createTestEvent({ type: 'page', event: 'Page Viewed' }),
      createTestEvent({ type: 'identify' }),
    ]

    await router.route(events)

    // Analytics: only track events
    expect(analyticsEvents).toHaveLength(2)
    expect(analyticsEvents[0].properties?.source).toBe('analytics')

    // Marketing: all except 'Internal Action', userId masked
    expect(marketingEvents).toHaveLength(3)
    expect(marketingEvents.every((e) => e.userId === '***MASKED***')).toBe(true)
    expect(marketingEvents.find((e) => e.event === 'Internal Action')).toBeUndefined()

    // Audit: all events unmodified
    expect(auditEvents).toHaveLength(4)
  })
})
