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

// ============================================================================
// ROUTE MATCHING TESTS
// ============================================================================

describe('Route Matching', () => {
  describe('event type matching', () => {
    it('should match single event type', async () => {
      const router = createDestinationRouter()
      const dest = createMockDestination('track-only')
      dest.eventTypes = ['track']
      router.addDestination(dest)

      await router.route([
        createTestEvent({ type: 'track' }),
        createTestEvent({ type: 'page' }),
        createTestEvent({ type: 'identify' }),
      ])

      expect(dest.events).toHaveLength(1)
      expect(dest.events[0].type).toBe('track')
    })

    it('should match multiple event types', async () => {
      const router = createDestinationRouter()
      const dest = createMockDestination('multi-type')
      dest.eventTypes = ['track', 'page', 'screen']
      router.addDestination(dest)

      await router.route([
        createTestEvent({ type: 'track' }),
        createTestEvent({ type: 'page' }),
        createTestEvent({ type: 'screen' }),
        createTestEvent({ type: 'identify' }),
        createTestEvent({ type: 'group' }),
        createTestEvent({ type: 'alias' }),
      ])

      expect(dest.events).toHaveLength(3)
      expect(dest.events.map((e) => e.type).sort()).toEqual(['page', 'screen', 'track'])
    })

    it('should match all event types when none specified', async () => {
      const router = createDestinationRouter()
      const dest = createMockDestination('all-types')
      router.addDestination(dest)

      const allTypes: Array<AnalyticsEvent['type']> = [
        'track',
        'page',
        'screen',
        'identify',
        'group',
        'alias',
      ]
      await router.route(allTypes.map((type) => createTestEvent({ type })))

      expect(dest.events).toHaveLength(6)
    })
  })

  describe('property-based matching', () => {
    it('should match events by property value', async () => {
      const router = createDestinationRouter()
      const premiumDest = createMockDestination('premium')
      premiumDest.filter = filterByProperty('plan', (v) => v === 'premium' || v === 'enterprise')
      router.addDestination(premiumDest)

      await router.route([
        createTestEvent({ properties: { plan: 'free' } }),
        createTestEvent({ properties: { plan: 'premium' } }),
        createTestEvent({ properties: { plan: 'enterprise' } }),
        createTestEvent({ properties: { plan: 'basic' } }),
      ])

      expect(premiumDest.events).toHaveLength(2)
    })

    it('should match events by numeric property range', async () => {
      const router = createDestinationRouter()
      const highValueDest = createMockDestination('high-value')
      highValueDest.filter = filterByProperty('amount', (v) => typeof v === 'number' && v >= 1000)
      router.addDestination(highValueDest)

      await router.route([
        createTestEvent({ properties: { amount: 50 } }),
        createTestEvent({ properties: { amount: 500 } }),
        createTestEvent({ properties: { amount: 1000 } }),
        createTestEvent({ properties: { amount: 5000 } }),
        createTestEvent({ properties: {} }), // No amount
      ])

      expect(highValueDest.events).toHaveLength(2)
    })

    it('should match events by nested property', async () => {
      const router = createDestinationRouter()
      const dest = createMockDestination('nested')
      dest.filter = (event) => {
        const metadata = event.properties?.metadata as Record<string, unknown> | undefined
        return metadata?.important === true
      }
      router.addDestination(dest)

      await router.route([
        createTestEvent({ properties: { metadata: { important: true } } }),
        createTestEvent({ properties: { metadata: { important: false } } }),
        createTestEvent({ properties: { metadata: {} } }),
        createTestEvent({ properties: {} }),
      ])

      expect(dest.events).toHaveLength(1)
    })
  })

  describe('event name matching', () => {
    it('should match events by exact name', async () => {
      const router = createDestinationRouter()
      const dest = createMockDestination('purchase-tracker')
      dest.filter = includeEvents('Purchase Completed', 'Order Placed')
      router.addDestination(dest)

      await router.route([
        createTestEvent({ event: 'Purchase Completed' }),
        createTestEvent({ event: 'Order Placed' }),
        createTestEvent({ event: 'Button Clicked' }),
        createTestEvent({ event: 'Page Viewed' }),
      ])

      expect(dest.events).toHaveLength(2)
    })

    it('should match events by pattern (custom filter)', async () => {
      const router = createDestinationRouter()
      const dest = createMockDestination('error-tracker')
      dest.filter = (event) => event.event?.toLowerCase().includes('error') ?? false
      router.addDestination(dest)

      await router.route([
        createTestEvent({ event: 'Error Occurred' }),
        createTestEvent({ event: 'API Error' }),
        createTestEvent({ event: 'Validation Error Detected' }),
        createTestEvent({ event: 'Success' }),
        createTestEvent({ event: 'Button Clicked' }),
      ])

      expect(dest.events).toHaveLength(3)
    })
  })
})

// ============================================================================
// MULTI-DESTINATION ROUTING TESTS
// ============================================================================

describe('Multi-Destination Routing', () => {
  it('should fan-out events to all matching destinations', async () => {
    const router = createDestinationRouter()

    const dest1Events: AnalyticsEvent[] = []
    const dest2Events: AnalyticsEvent[] = []
    const dest3Events: AnalyticsEvent[] = []

    router.addDestination({
      name: 'dest1',
      send: async (events) => dest1Events.push(...events),
    })
    router.addDestination({
      name: 'dest2',
      send: async (events) => dest2Events.push(...events),
    })
    router.addDestination({
      name: 'dest3',
      send: async (events) => dest3Events.push(...events),
    })

    const events = [createTestEvent(), createTestEvent(), createTestEvent()]
    await router.route(events)

    // All destinations should receive all events
    expect(dest1Events).toHaveLength(3)
    expect(dest2Events).toHaveLength(3)
    expect(dest3Events).toHaveLength(3)
  })

  it('should apply different filters per destination', async () => {
    const router = createDestinationRouter()

    const trackDest: AnalyticsEvent[] = []
    const pageDest: AnalyticsEvent[] = []
    const identifyDest: AnalyticsEvent[] = []

    router.addDestination({
      name: 'track-dest',
      eventTypes: ['track'],
      send: async (events) => trackDest.push(...events),
    })
    router.addDestination({
      name: 'page-dest',
      eventTypes: ['page'],
      send: async (events) => pageDest.push(...events),
    })
    router.addDestination({
      name: 'identify-dest',
      eventTypes: ['identify'],
      send: async (events) => identifyDest.push(...events),
    })

    await router.route([
      createTestEvent({ type: 'track' }),
      createTestEvent({ type: 'track' }),
      createTestEvent({ type: 'page' }),
      createTestEvent({ type: 'identify' }),
      createTestEvent({ type: 'identify' }),
      createTestEvent({ type: 'identify' }),
    ])

    expect(trackDest).toHaveLength(2)
    expect(pageDest).toHaveLength(1)
    expect(identifyDest).toHaveLength(3)
  })

  it('should apply different transforms per destination', async () => {
    const router = createDestinationRouter()

    const rawDest: AnalyticsEvent[] = []
    const anonymizedDest: AnalyticsEvent[] = []
    const enrichedDest: AnalyticsEvent[] = []

    router.addDestination({
      name: 'raw',
      send: async (events) => rawDest.push(...events),
    })
    router.addDestination({
      name: 'anonymized',
      transform: chainTransforms(
        maskEventFields('userId', 'anonymousId'),
        removeProperties('email', 'phone')
      ),
      send: async (events) => anonymizedDest.push(...events),
    })
    router.addDestination({
      name: 'enriched',
      transform: addProperties({ processedAt: 'now', version: '1.0' }),
      send: async (events) => enrichedDest.push(...events),
    })

    await router.route([
      createTestEvent({
        userId: 'user_123',
        anonymousId: 'anon_456',
        properties: { email: 'test@example.com', phone: '555-1234', amount: 100 },
      }),
    ])

    // Raw destination gets original event
    expect(rawDest[0].userId).toBe('user_123')
    expect(rawDest[0].properties?.email).toBe('test@example.com')

    // Anonymized destination gets masked/stripped event
    expect(anonymizedDest[0].userId).toBe('***MASKED***')
    expect(anonymizedDest[0].anonymousId).toBe('***MASKED***')
    expect(anonymizedDest[0].properties?.email).toBeUndefined()
    expect(anonymizedDest[0].properties?.phone).toBeUndefined()
    expect(anonymizedDest[0].properties?.amount).toBe(100)

    // Enriched destination gets additional properties
    expect(enrichedDest[0].properties?.processedAt).toBe('now')
    expect(enrichedDest[0].properties?.version).toBe('1.0')
  })

  it('should handle partial failures across destinations', async () => {
    const router = createDestinationRouter({
      continueOnError: true,
      defaultRetry: { maxAttempts: 0 },
    })

    const successDest1: AnalyticsEvent[] = []
    const successDest2: AnalyticsEvent[] = []

    router.addDestination({
      name: 'success1',
      priority: 10,
      send: async (events) => successDest1.push(...events),
    })
    router.addDestination({
      name: 'failing',
      priority: 5,
      send: async () => {
        throw new Error('Destination failed')
      },
    })
    router.addDestination({
      name: 'success2',
      priority: 1,
      send: async (events) => successDest2.push(...events),
    })

    const result = await router.route([createTestEvent()])

    // Overall result is failure, but successful destinations received events
    expect(result.success).toBe(false)
    expect(successDest1).toHaveLength(1)
    expect(successDest2).toHaveLength(1)
    expect(result.destinations.filter((d) => d.success)).toHaveLength(2)
    expect(result.destinations.filter((d) => !d.success)).toHaveLength(1)
  })
})

// ============================================================================
// FALLBACK DESTINATION TESTS
// ============================================================================

describe('Fallback Destinations', () => {
  it('should use fallback when primary destination fails', async () => {
    const router = createDestinationRouter({
      parallel: false,
      continueOnError: true,
      defaultRetry: { maxAttempts: 0 },
    })

    const primaryEvents: AnalyticsEvent[] = []
    const fallbackEvents: AnalyticsEvent[] = []
    let primaryFailed = false

    router.addDestination({
      name: 'primary',
      priority: 10,
      send: async () => {
        throw new Error('Primary failed')
      },
      onError: () => {
        primaryFailed = true
      },
    })

    router.addDestination({
      name: 'fallback',
      priority: 5,
      send: async (events) => {
        if (primaryFailed) {
          fallbackEvents.push(...events)
        } else {
          primaryEvents.push(...events)
        }
      },
    })

    await router.route([createTestEvent(), createTestEvent()])

    expect(primaryFailed).toBe(true)
    expect(fallbackEvents).toHaveLength(2)
  })

  it('should implement dead letter queue pattern', async () => {
    const router = createDestinationRouter({
      continueOnError: true,
      defaultRetry: { maxAttempts: 1 },
    })

    const deadLetterQueue: Array<{ error: Error; events: AnalyticsEvent[] }> = []
    const successfulEvents: AnalyticsEvent[] = []
    let attemptCount = 0

    router.addDestination({
      name: 'main',
      send: async () => {
        attemptCount++
        throw new Error('Delivery failed')
      },
      onError: (error, events) => {
        // After all retries exhausted, push to DLQ
        deadLetterQueue.push({ error, events })
      },
    })

    router.addDestination({
      name: 'backup',
      send: async (events) => successfulEvents.push(...events),
    })

    await router.route([createTestEvent()])

    expect(attemptCount).toBe(2) // Initial + 1 retry
    expect(deadLetterQueue).toHaveLength(1)
    expect(deadLetterQueue[0].events).toHaveLength(1)
    expect(successfulEvents).toHaveLength(1) // Backup still succeeded
  })

  it('should cascade through multiple fallback levels', async () => {
    const router = createDestinationRouter({
      parallel: false,
      continueOnError: true,
      defaultRetry: { maxAttempts: 0 },
    })

    const deliveredTo: string[] = []
    let level1Available = false
    let level2Available = false

    router.addDestination({
      name: 'level1-primary',
      priority: 30,
      send: async () => {
        if (!level1Available) throw new Error('Level 1 unavailable')
        deliveredTo.push('level1')
      },
    })

    router.addDestination({
      name: 'level2-backup',
      priority: 20,
      send: async () => {
        if (!level2Available) throw new Error('Level 2 unavailable')
        deliveredTo.push('level2')
      },
    })

    router.addDestination({
      name: 'level3-fallback',
      priority: 10,
      send: async () => {
        deliveredTo.push('level3')
      },
    })

    // All fail except level 3
    await router.route([createTestEvent()])
    expect(deliveredTo).toContain('level3')

    // Enable level 2
    deliveredTo.length = 0
    level2Available = true
    await router.route([createTestEvent()])
    expect(deliveredTo).toContain('level2')
    expect(deliveredTo).toContain('level3') // Level 3 also receives (continueOnError)

    // Enable level 1
    deliveredTo.length = 0
    level1Available = true
    await router.route([createTestEvent()])
    expect(deliveredTo).toContain('level1')
    expect(deliveredTo).toContain('level2')
    expect(deliveredTo).toContain('level3')
  })
})

// ============================================================================
// CONDITIONAL ROUTING TESTS
// ============================================================================

describe('Conditional Routing', () => {
  describe('user-based routing', () => {
    it('should route based on user segments', async () => {
      const router = createDestinationRouter()

      const betaEvents: AnalyticsEvent[] = []
      const generalEvents: AnalyticsEvent[] = []

      const betaUsers = new Set(['user_beta_1', 'user_beta_2', 'user_beta_3'])

      router.addDestination({
        name: 'beta-analytics',
        filter: (event) => betaUsers.has(event.userId ?? ''),
        send: async (events) => betaEvents.push(...events),
      })

      router.addDestination({
        name: 'general-analytics',
        filter: (event) => !betaUsers.has(event.userId ?? ''),
        send: async (events) => generalEvents.push(...events),
      })

      await router.route([
        createTestEvent({ userId: 'user_beta_1' }),
        createTestEvent({ userId: 'user_regular' }),
        createTestEvent({ userId: 'user_beta_2' }),
        createTestEvent({ userId: 'user_another' }),
      ])

      expect(betaEvents).toHaveLength(2)
      expect(generalEvents).toHaveLength(2)
    })

    it('should route VIP users to priority destinations', async () => {
      const router = createDestinationRouter()

      const vipEvents: AnalyticsEvent[] = []
      const standardEvents: AnalyticsEvent[] = []

      router.addDestination({
        name: 'vip-support',
        filter: filterByProperty('customerTier', (v) => v === 'vip' || v === 'enterprise'),
        transform: addProperties({ priority: 'high' }),
        send: async (events) => vipEvents.push(...events),
      })

      router.addDestination({
        name: 'standard-queue',
        filter: filterByProperty('customerTier', (v) => v !== 'vip' && v !== 'enterprise'),
        send: async (events) => standardEvents.push(...events),
      })

      await router.route([
        createTestEvent({ properties: { customerTier: 'vip', issue: 'urgent' } }),
        createTestEvent({ properties: { customerTier: 'free', issue: 'question' } }),
        createTestEvent({ properties: { customerTier: 'enterprise', issue: 'critical' } }),
        createTestEvent({ properties: { customerTier: 'basic', issue: 'minor' } }),
      ])

      expect(vipEvents).toHaveLength(2)
      expect(vipEvents.every((e) => e.properties?.priority === 'high')).toBe(true)
      expect(standardEvents).toHaveLength(2)
    })
  })

  describe('context-based routing', () => {
    it('should route based on event context', async () => {
      const router = createDestinationRouter()

      const mobileEvents: AnalyticsEvent[] = []
      const webEvents: AnalyticsEvent[] = []

      router.addDestination({
        name: 'mobile-analytics',
        filter: (event) => {
          const device = event.context?.device as Record<string, unknown> | undefined
          return device?.type === 'mobile' || device?.type === 'tablet'
        },
        send: async (events) => mobileEvents.push(...events),
      })

      router.addDestination({
        name: 'web-analytics',
        filter: (event) => {
          const device = event.context?.device as Record<string, unknown> | undefined
          return device?.type === 'desktop' || device?.type === 'web'
        },
        send: async (events) => webEvents.push(...events),
      })

      await router.route([
        createTestEvent({ context: { device: { type: 'mobile' } } }),
        createTestEvent({ context: { device: { type: 'desktop' } } }),
        createTestEvent({ context: { device: { type: 'tablet' } } }),
        createTestEvent({ context: { device: { type: 'web' } } }),
      ])

      expect(mobileEvents).toHaveLength(2)
      expect(webEvents).toHaveLength(2)
    })

    it('should route based on geo location', async () => {
      const router = createDestinationRouter()

      const euEvents: AnalyticsEvent[] = []
      const usEvents: AnalyticsEvent[] = []
      const otherEvents: AnalyticsEvent[] = []

      const euCountries = new Set(['DE', 'FR', 'IT', 'ES', 'NL', 'BE'])
      const usRegions = new Set(['US', 'CA'])

      router.addDestination({
        name: 'eu-analytics',
        filter: (event) => {
          const country = event.context?.location as Record<string, unknown> | undefined
          return euCountries.has(country?.country as string)
        },
        send: async (events) => euEvents.push(...events),
      })

      router.addDestination({
        name: 'us-analytics',
        filter: (event) => {
          const country = event.context?.location as Record<string, unknown> | undefined
          return usRegions.has(country?.country as string)
        },
        send: async (events) => usEvents.push(...events),
      })

      router.addDestination({
        name: 'other-analytics',
        filter: (event) => {
          const country = event.context?.location as Record<string, unknown> | undefined
          const c = country?.country as string
          return !euCountries.has(c) && !usRegions.has(c)
        },
        send: async (events) => otherEvents.push(...events),
      })

      await router.route([
        createTestEvent({ context: { location: { country: 'DE' } } }),
        createTestEvent({ context: { location: { country: 'US' } } }),
        createTestEvent({ context: { location: { country: 'JP' } } }),
        createTestEvent({ context: { location: { country: 'FR' } } }),
        createTestEvent({ context: { location: { country: 'CA' } } }),
        createTestEvent({ context: { location: { country: 'AU' } } }),
      ])

      expect(euEvents).toHaveLength(2) // DE, FR
      expect(usEvents).toHaveLength(2) // US, CA
      expect(otherEvents).toHaveLength(2) // JP, AU
    })
  })

  describe('time-based routing', () => {
    it('should route based on timestamp', async () => {
      const router = createDestinationRouter()

      const recentEvents: AnalyticsEvent[] = []
      const historicalEvents: AnalyticsEvent[] = []

      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

      router.addDestination({
        name: 'recent-analytics',
        filter: (event) => {
          const eventTime = new Date(event.timestamp).getTime()
          const cutoff = Date.now() - 12 * 60 * 60 * 1000 // 12 hours
          return eventTime > cutoff
        },
        send: async (events) => recentEvents.push(...events),
      })

      router.addDestination({
        name: 'historical-analytics',
        filter: (event) => {
          const eventTime = new Date(event.timestamp).getTime()
          const cutoff = Date.now() - 12 * 60 * 60 * 1000 // 12 hours
          return eventTime <= cutoff
        },
        send: async (events) => historicalEvents.push(...events),
      })

      await router.route([
        createTestEvent({ timestamp: new Date().toISOString() }), // Now
        createTestEvent({ timestamp: oneHourAgo }), // Recent
        createTestEvent({ timestamp: oneDayAgo }), // Historical
        createTestEvent({ timestamp: oneWeekAgo }), // Historical
      ])

      expect(recentEvents).toHaveLength(2) // Now and 1 hour ago
      expect(historicalEvents).toHaveLength(2) // 1 day and 1 week ago
    })
  })

  describe('complex conditional logic', () => {
    it('should support AND conditions', async () => {
      const router = createDestinationRouter()
      const matchedEvents: AnalyticsEvent[] = []

      router.addDestination({
        name: 'complex-and',
        filter: andFilters(
          filterByEventType('track'),
          filterByProperty('amount', (v) => typeof v === 'number' && v > 100),
          (event) => event.userId?.startsWith('premium_') ?? false
        ),
        send: async (events) => matchedEvents.push(...events),
      })

      await router.route([
        createTestEvent({ type: 'track', userId: 'premium_1', properties: { amount: 200 } }),
        createTestEvent({ type: 'track', userId: 'regular_1', properties: { amount: 200 } }),
        createTestEvent({ type: 'track', userId: 'premium_2', properties: { amount: 50 } }),
        createTestEvent({ type: 'page', userId: 'premium_3', properties: { amount: 200 } }),
      ])

      expect(matchedEvents).toHaveLength(1)
      expect(matchedEvents[0].userId).toBe('premium_1')
    })

    it('should support OR conditions', async () => {
      const router = createDestinationRouter()
      const matchedEvents: AnalyticsEvent[] = []

      router.addDestination({
        name: 'complex-or',
        filter: orFilters(
          filterByProperty('priority', (v) => v === 'critical'),
          filterByProperty('amount', (v) => typeof v === 'number' && v > 10000),
          (event) => event.event === 'Error Occurred'
        ),
        send: async (events) => matchedEvents.push(...events),
      })

      await router.route([
        createTestEvent({ event: 'Purchase', properties: { priority: 'critical' } }),
        createTestEvent({ event: 'Purchase', properties: { amount: 15000 } }),
        createTestEvent({ event: 'Error Occurred', properties: {} }),
        createTestEvent({ event: 'Click', properties: { amount: 50 } }),
      ])

      expect(matchedEvents).toHaveLength(3)
    })

    it('should support NOT conditions', async () => {
      const router = createDestinationRouter()
      const matchedEvents: AnalyticsEvent[] = []

      router.addDestination({
        name: 'complex-not',
        filter: andFilters(
          filterByEventType('track'),
          notFilter(excludeEvents('Internal Event', 'Debug Event', 'Test Event'))
        ),
        send: async (events) => matchedEvents.push(...events),
      })

      await router.route([
        createTestEvent({ type: 'track', event: 'Internal Event' }),
        createTestEvent({ type: 'track', event: 'Debug Event' }),
        createTestEvent({ type: 'track', event: 'Real Event' }),
        createTestEvent({ type: 'track', event: 'Another Real Event' }),
      ])

      expect(matchedEvents).toHaveLength(2)
    })
  })
})

// ============================================================================
// ROUTE PRIORITY TESTS
// ============================================================================

describe('Route Priority', () => {
  it('should process high priority destinations first in sequential mode', async () => {
    const router = createDestinationRouter({ parallel: false })
    const processingOrder: string[] = []

    router.addDestination({
      name: 'low-priority',
      priority: 1,
      send: async () => processingOrder.push('low'),
    })
    router.addDestination({
      name: 'medium-priority',
      priority: 5,
      send: async () => processingOrder.push('medium'),
    })
    router.addDestination({
      name: 'high-priority',
      priority: 10,
      send: async () => processingOrder.push('high'),
    })
    router.addDestination({
      name: 'critical-priority',
      priority: 100,
      send: async () => processingOrder.push('critical'),
    })

    await router.route([createTestEvent()])

    expect(processingOrder).toEqual(['critical', 'high', 'medium', 'low'])
  })

  it('should handle equal priorities', async () => {
    const router = createDestinationRouter({ parallel: false })
    const processed: string[] = []

    router.addDestination({
      name: 'dest-a',
      priority: 5,
      send: async () => processed.push('a'),
    })
    router.addDestination({
      name: 'dest-b',
      priority: 5,
      send: async () => processed.push('b'),
    })
    router.addDestination({
      name: 'dest-c',
      priority: 5,
      send: async () => processed.push('c'),
    })

    await router.route([createTestEvent()])

    // All should be processed, order may vary for equal priorities
    expect(processed).toHaveLength(3)
    expect(processed).toContain('a')
    expect(processed).toContain('b')
    expect(processed).toContain('c')
  })

  it('should default to priority 0', async () => {
    const router = createDestinationRouter({ parallel: false })
    const processingOrder: string[] = []

    router.addDestination({
      name: 'with-priority',
      priority: 5,
      send: async () => processingOrder.push('prioritized'),
    })
    router.addDestination({
      name: 'without-priority',
      // No priority specified, defaults to 0
      send: async () => processingOrder.push('default'),
    })

    await router.route([createTestEvent()])

    expect(processingOrder).toEqual(['prioritized', 'default'])
  })

  it('should support negative priorities', async () => {
    const router = createDestinationRouter({ parallel: false })
    const processingOrder: string[] = []

    router.addDestination({
      name: 'normal',
      priority: 0,
      send: async () => processingOrder.push('normal'),
    })
    router.addDestination({
      name: 'low',
      priority: -10,
      send: async () => processingOrder.push('low'),
    })
    router.addDestination({
      name: 'very-low',
      priority: -100,
      send: async () => processingOrder.push('very-low'),
    })

    await router.route([createTestEvent()])

    expect(processingOrder).toEqual(['normal', 'low', 'very-low'])
  })

  it('should stop at failing high-priority destination when continueOnError=false', async () => {
    const router = createDestinationRouter({
      parallel: false,
      continueOnError: false,
      defaultRetry: { maxAttempts: 0 },
    })
    const processed: string[] = []

    router.addDestination({
      name: 'highest',
      priority: 100,
      send: async () => {
        processed.push('highest')
        throw new Error('Critical failure')
      },
    })
    router.addDestination({
      name: 'high',
      priority: 50,
      send: async () => processed.push('high'),
    })
    router.addDestination({
      name: 'low',
      priority: 10,
      send: async () => processed.push('low'),
    })

    const result = await router.route([createTestEvent()])

    expect(result.success).toBe(false)
    expect(processed).toEqual(['highest'])
    // Lower priority destinations never ran
  })
})

// ============================================================================
// ANALYTICS ROUTING SCENARIOS
// ============================================================================

describe('Analytics Routing Scenarios', () => {
  describe('multi-provider analytics', () => {
    it('should route to multiple analytics providers with different requirements', async () => {
      const router = createDestinationRouter()

      const googleAnalytics: AnalyticsEvent[] = []
      const mixpanel: AnalyticsEvent[] = []
      const amplitude: AnalyticsEvent[] = []
      const segment: AnalyticsEvent[] = []

      // Google Analytics - only page and screen events, limited properties
      router.addDestination({
        name: 'google-analytics',
        eventTypes: ['page', 'screen'],
        transform: removeProperties('userId', 'email', 'internalId'),
        send: async (events) => googleAnalytics.push(...events),
      })

      // Mixpanel - all events, rename properties to match schema
      router.addDestination({
        name: 'mixpanel',
        transform: renameProperties({
          userId: 'distinct_id',
          event: '$event_name',
        }),
        send: async (events) => mixpanel.push(...events),
      })

      // Amplitude - only track events, add device context
      router.addDestination({
        name: 'amplitude',
        eventTypes: ['track'],
        transform: addProperties({ platform: 'web', sdk_version: '1.0.0' }),
        send: async (events) => amplitude.push(...events),
      })

      // Segment - all events with PII masking
      router.addDestination({
        name: 'segment',
        transform: chainTransforms(
          maskProperties('email', 'phone', 'ssn'),
          maskEventFields('userId')
        ),
        send: async (events) => segment.push(...events),
      })

      const events = [
        createTestEvent({
          type: 'track',
          userId: 'user_123',
          event: 'Purchase Completed',
          properties: { amount: 99.99, email: 'test@example.com' },
        }),
        createTestEvent({
          type: 'page',
          userId: 'user_123',
          properties: { path: '/checkout', internalId: 'xyz' },
        }),
        createTestEvent({
          type: 'identify',
          userId: 'user_123',
          traits: { email: 'test@example.com', phone: '555-1234' },
        }),
      ]

      await router.route(events)

      // Google Analytics: only page event, no userId
      expect(googleAnalytics).toHaveLength(1)
      expect(googleAnalytics[0].type).toBe('page')
      expect(googleAnalytics[0].properties?.userId).toBeUndefined()
      expect(googleAnalytics[0].properties?.internalId).toBeUndefined()

      // Mixpanel: all events with renamed properties
      expect(mixpanel).toHaveLength(3)

      // Amplitude: only track event with added properties
      expect(amplitude).toHaveLength(1)
      expect(amplitude[0].type).toBe('track')
      expect(amplitude[0].properties?.platform).toBe('web')

      // Segment: all events with masked PII
      expect(segment).toHaveLength(3)
      expect(segment[0].userId).toBe('***MASKED***')
      expect(segment[0].properties?.email).toBe('***MASKED***')
    })
  })

  describe('compliance and data governance', () => {
    it('should route GDPR-compliant data to EU destinations', async () => {
      const router = createDestinationRouter()

      const euAnalytics: AnalyticsEvent[] = []
      const globalAnalytics: AnalyticsEvent[] = []

      const piiFields = ['email', 'phone', 'address', 'ssn', 'ip']

      router.addDestination({
        name: 'eu-analytics',
        transform: (event) => {
          // Remove all PII for EU compliance
          const newProps = { ...event.properties }
          for (const field of piiFields) {
            delete newProps[field]
          }
          return {
            ...event,
            userId: undefined,
            anonymousId: event.anonymousId, // Keep anonymous ID only
            properties: newProps,
          }
        },
        send: async (events) => euAnalytics.push(...events),
      })

      router.addDestination({
        name: 'global-analytics',
        transform: maskProperties(...piiFields),
        send: async (events) => globalAnalytics.push(...events),
      })

      await router.route([
        createTestEvent({
          userId: 'user_123',
          anonymousId: 'anon_456',
          properties: {
            email: 'test@example.com',
            phone: '555-1234',
            product: 'Widget',
            amount: 99.99,
          },
        }),
      ])

      // EU analytics: completely stripped of PII
      expect(euAnalytics[0].userId).toBeUndefined()
      expect(euAnalytics[0].anonymousId).toBe('anon_456')
      expect(euAnalytics[0].properties?.email).toBeUndefined()
      expect(euAnalytics[0].properties?.phone).toBeUndefined()
      expect(euAnalytics[0].properties?.product).toBe('Widget')

      // Global analytics: PII masked but present
      expect(globalAnalytics[0].properties?.email).toBe('***MASKED***')
      expect(globalAnalytics[0].properties?.phone).toBe('***MASKED***')
      expect(globalAnalytics[0].properties?.product).toBe('Widget')
    })

    it('should filter events based on consent flags', async () => {
      const router = createDestinationRouter()

      const marketingEvents: AnalyticsEvent[] = []
      const analyticsEvents: AnalyticsEvent[] = []
      const essentialEvents: AnalyticsEvent[] = []

      router.addDestination({
        name: 'marketing',
        filter: (event) => {
          const consent = event.context?.consent as Record<string, boolean> | undefined
          return consent?.marketing === true
        },
        send: async (events) => marketingEvents.push(...events),
      })

      router.addDestination({
        name: 'analytics',
        filter: (event) => {
          const consent = event.context?.consent as Record<string, boolean> | undefined
          return consent?.analytics === true
        },
        send: async (events) => analyticsEvents.push(...events),
      })

      router.addDestination({
        name: 'essential',
        // Essential always receives events
        send: async (events) => essentialEvents.push(...events),
      })

      await router.route([
        createTestEvent({
          context: { consent: { marketing: true, analytics: true } },
        }),
        createTestEvent({
          context: { consent: { marketing: false, analytics: true } },
        }),
        createTestEvent({
          context: { consent: { marketing: false, analytics: false } },
        }),
        createTestEvent({
          context: { consent: { marketing: true, analytics: false } },
        }),
      ])

      expect(marketingEvents).toHaveLength(2)
      expect(analyticsEvents).toHaveLength(2)
      expect(essentialEvents).toHaveLength(4) // All events
    })
  })

  describe('real-time vs batch processing', () => {
    it('should route high-priority events to real-time pipeline', async () => {
      const router = createDestinationRouter()

      const realTimeEvents: AnalyticsEvent[] = []
      const batchEvents: AnalyticsEvent[] = []

      const realTimeEventNames = new Set([
        'Error Occurred',
        'Payment Failed',
        'Security Alert',
        'System Down',
      ])

      router.addDestination({
        name: 'real-time-pipeline',
        priority: 100,
        filter: (event) => realTimeEventNames.has(event.event ?? ''),
        send: async (events) => realTimeEvents.push(...events),
      })

      router.addDestination({
        name: 'batch-pipeline',
        priority: 10,
        filter: (event) => !realTimeEventNames.has(event.event ?? ''),
        send: async (events) => batchEvents.push(...events),
      })

      await router.route([
        createTestEvent({ event: 'Error Occurred' }),
        createTestEvent({ event: 'Page Viewed' }),
        createTestEvent({ event: 'Payment Failed' }),
        createTestEvent({ event: 'Button Clicked' }),
        createTestEvent({ event: 'Security Alert' }),
      ])

      expect(realTimeEvents).toHaveLength(3)
      expect(batchEvents).toHaveLength(2)
    })
  })

  describe('A/B testing and experimentation', () => {
    it('should route events to different experiment variants', async () => {
      const router = createDestinationRouter()

      const controlEvents: AnalyticsEvent[] = []
      const variantAEvents: AnalyticsEvent[] = []
      const variantBEvents: AnalyticsEvent[] = []

      router.addDestination({
        name: 'control',
        filter: (event) => {
          const experiment = event.properties?.experimentVariant
          return experiment === 'control'
        },
        send: async (events) => controlEvents.push(...events),
      })

      router.addDestination({
        name: 'variant-a',
        filter: (event) => {
          const experiment = event.properties?.experimentVariant
          return experiment === 'variant_a'
        },
        send: async (events) => variantAEvents.push(...events),
      })

      router.addDestination({
        name: 'variant-b',
        filter: (event) => {
          const experiment = event.properties?.experimentVariant
          return experiment === 'variant_b'
        },
        send: async (events) => variantBEvents.push(...events),
      })

      await router.route([
        createTestEvent({ properties: { experimentVariant: 'control', action: 'click' } }),
        createTestEvent({ properties: { experimentVariant: 'variant_a', action: 'click' } }),
        createTestEvent({ properties: { experimentVariant: 'variant_b', action: 'click' } }),
        createTestEvent({ properties: { experimentVariant: 'control', action: 'purchase' } }),
        createTestEvent({ properties: { experimentVariant: 'variant_a', action: 'purchase' } }),
      ])

      expect(controlEvents).toHaveLength(2)
      expect(variantAEvents).toHaveLength(2)
      expect(variantBEvents).toHaveLength(1)
    })
  })

  describe('cost optimization', () => {
    it('should sample events for high-volume destinations', async () => {
      const router = createDestinationRouter()

      const fullFidelityEvents: AnalyticsEvent[] = []
      const sampledEvents: AnalyticsEvent[] = []

      // High-value events go to full-fidelity destination
      router.addDestination({
        name: 'full-fidelity',
        filter: orFilters(
          filterByProperty('amount', (v) => typeof v === 'number' && v > 100),
          includeEvents('Error Occurred', 'Purchase Completed')
        ),
        send: async (events) => fullFidelityEvents.push(...events),
      })

      // Sample 10% of other events
      let sampleCounter = 0
      router.addDestination({
        name: 'sampled',
        filter: (event) => {
          // Always include high-value
          const amount = event.properties?.amount as number | undefined
          if (amount && amount > 100) return false // Already in full-fidelity
          if (event.event === 'Error Occurred' || event.event === 'Purchase Completed')
            return false

          // 10% sampling
          sampleCounter++
          return sampleCounter % 10 === 0
        },
        send: async (events) => sampledEvents.push(...events),
      })

      // Generate 100 low-value events
      const events = Array(100)
        .fill(null)
        .map((_, i) =>
          createTestEvent({
            event: 'Page Viewed',
            properties: { pageIndex: i, amount: 10 },
          })
        )

      // Add some high-value events
      events.push(
        createTestEvent({ event: 'Purchase Completed', properties: { amount: 500 } }),
        createTestEvent({ event: 'Error Occurred', properties: {} }),
        createTestEvent({ properties: { amount: 200 } })
      )

      await router.route(events)

      expect(fullFidelityEvents).toHaveLength(3) // High-value events
      expect(sampledEvents).toHaveLength(10) // 10% of 100 low-value events
    })
  })
})
