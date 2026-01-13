/**
 * Inngest Debounce Feature Tests
 *
 * Tests for Inngest debounce functionality including:
 * - Basic debounce timing
 * - Debounce by key
 * - Debounce timeout
 * - Debounce with event accumulation
 * - Edge cases and race conditions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Inngest } from './index'

// ============================================================================
// DEBOUNCE MANAGER IMPLEMENTATION
// ============================================================================

interface DebounceConfig {
  /** Key expression to group debounces */
  key?: string
  /** Debounce period */
  period: string | number
  /** Maximum time to wait (timeout) */
  timeout?: string | number
}

interface DebouncedEvent {
  name: string
  data: unknown
  ts: number
  id: string
}

interface DebounceState {
  events: DebouncedEvent[]
  timeoutId: ReturnType<typeof setTimeout> | null
  maxTimeoutId: ReturnType<typeof setTimeout> | null
  firstEventTime: number
}

function parseDuration(duration: string | number): number {
  if (typeof duration === 'number') return duration

  const match = duration.match(/^(\d+)(ms|s|m|h)$/)
  if (!match) return 0

  const value = parseInt(match[1], 10)
  const unit = match[2]

  switch (unit) {
    case 'ms':
      return value
    case 's':
      return value * 1000
    case 'm':
      return value * 60 * 1000
    case 'h':
      return value * 60 * 60 * 1000
    default:
      return 0
  }
}

function getValueByPath(obj: unknown, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj
  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

class DebounceManager {
  private debounces = new Map<string, DebounceState>()

  /**
   * Add an event to debounce tracking
   * Returns true if event should trigger function execution
   */
  addEvent(
    key: string,
    event: DebouncedEvent,
    config: DebounceConfig,
    onDebounceComplete: (events: DebouncedEvent[]) => void
  ): void {
    const periodMs = parseDuration(config.period)
    const timeoutMs = config.timeout ? parseDuration(config.timeout) : undefined

    let state = this.debounces.get(key)

    if (!state) {
      state = {
        events: [],
        timeoutId: null,
        maxTimeoutId: null,
        firstEventTime: Date.now(),
      }
      this.debounces.set(key, state)

      // Set max timeout if configured
      if (timeoutMs) {
        state.maxTimeoutId = setTimeout(() => {
          this.flush(key, onDebounceComplete)
        }, timeoutMs)
      }
    }

    // Add event to accumulator
    state.events.push(event)

    // Reset the debounce timer
    if (state.timeoutId) {
      clearTimeout(state.timeoutId)
    }

    state.timeoutId = setTimeout(() => {
      this.flush(key, onDebounceComplete)
    }, periodMs)
  }

  /**
   * Flush debounced events and execute
   */
  private flush(key: string, onDebounceComplete: (events: DebouncedEvent[]) => void): void {
    const state = this.debounces.get(key)
    if (!state || state.events.length === 0) return

    // Clear timers
    if (state.timeoutId) {
      clearTimeout(state.timeoutId)
    }
    if (state.maxTimeoutId) {
      clearTimeout(state.maxTimeoutId)
    }

    // Get events and clear state
    const events = state.events
    this.debounces.delete(key)

    // Trigger callback
    onDebounceComplete(events)
  }

  /**
   * Get current debounce state (for testing)
   */
  getState(key: string): DebounceState | undefined {
    return this.debounces.get(key)
  }

  /**
   * Get pending event count
   */
  getPendingCount(key: string): number {
    return this.debounces.get(key)?.events.length ?? 0
  }

  /**
   * Clear all debounces
   */
  clear(): void {
    for (const state of this.debounces.values()) {
      if (state.timeoutId) clearTimeout(state.timeoutId)
      if (state.maxTimeoutId) clearTimeout(state.maxTimeoutId)
    }
    this.debounces.clear()
  }
}

// ============================================================================
// INNGEST WITH DEBOUNCE EXTENSION
// ============================================================================

class InngestWithDebounce extends Inngest {
  private debounceManager = new DebounceManager()
  private eventHandlers = new Map<string, Set<{ fn: unknown; config: DebounceConfig }>>()

  /**
   * Create a function with debounce support
   */
  createDebouncedFunction<TEvent, TResult>(
    config: { id: string; debounce: DebounceConfig },
    trigger: { event: string },
    handler: (ctx: { event: DebouncedEvent; events: DebouncedEvent[]; step: unknown }) => Promise<TResult>
  ): { invoke: (event: DebouncedEvent) => void } {
    // Register event handler
    if (!this.eventHandlers.has(trigger.event)) {
      this.eventHandlers.set(trigger.event, new Set())
    }
    this.eventHandlers.get(trigger.event)!.add({ fn: handler, config: config.debounce })

    return {
      invoke: (event: DebouncedEvent) => {
        const keyPath = config.debounce.key
        let debounceKey = config.id

        if (keyPath) {
          const keyValue = getValueByPath({ event }, keyPath)
          debounceKey = `${config.id}:${String(keyValue)}`
        }

        this.debounceManager.addEvent(debounceKey, event, config.debounce, async (events) => {
          await handler({
            event: events[0],
            events,
            step: {},
          })
        })
      },
    }
  }

  getDebounceState(key: string): DebounceState | undefined {
    return this.debounceManager.getState(key)
  }

  getPendingDebounceCount(key: string): number {
    return this.debounceManager.getPendingCount(key)
  }

  clearDebounces(): void {
    this.debounceManager.clear()
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('Inngest Debounce Feature', () => {
  let inngest: InngestWithDebounce

  beforeEach(() => {
    inngest = new InngestWithDebounce({ id: 'debounce-test-app' })
    vi.useFakeTimers()
  })

  afterEach(() => {
    inngest.clearDebounces()
    vi.useRealTimers()
  })

  describe('Basic Debounce', () => {
    it('should debounce rapid events', async () => {
      let executionCount = 0
      let lastEventCount = 0

      const fn = inngest.createDebouncedFunction(
        {
          id: 'basic-debounce',
          debounce: { period: '500ms' },
        },
        { event: 'user/action' },
        async ({ events }) => {
          executionCount++
          lastEventCount = events.length
        }
      )

      // Fire 5 events rapidly
      for (let i = 0; i < 5; i++) {
        fn.invoke({ name: 'user/action', data: { seq: i }, ts: Date.now(), id: `evt-${i}` })
        await vi.advanceTimersByTimeAsync(100) // 100ms between each
      }

      // Not executed yet (within debounce period)
      expect(executionCount).toBe(0)

      // Advance past debounce period
      await vi.advanceTimersByTimeAsync(500)

      // Should have executed once with all 5 events
      expect(executionCount).toBe(1)
      expect(lastEventCount).toBe(5)
    })

    it('should execute after debounce period with no new events', async () => {
      let executed = false

      const fn = inngest.createDebouncedFunction(
        {
          id: 'single-debounce',
          debounce: { period: '200ms' },
        },
        { event: 'test/event' },
        async () => {
          executed = true
        }
      )

      fn.invoke({ name: 'test/event', data: {}, ts: Date.now(), id: 'evt-1' })

      // Not executed yet
      expect(executed).toBe(false)

      // Advance past debounce period
      await vi.advanceTimersByTimeAsync(250)

      expect(executed).toBe(true)
    })

    it('should reset debounce timer on new events', async () => {
      const executionTimes: number[] = []

      const fn = inngest.createDebouncedFunction(
        {
          id: 'reset-debounce',
          debounce: { period: '300ms' },
        },
        { event: 'test/reset' },
        async () => {
          executionTimes.push(Date.now())
        }
      )

      const startTime = Date.now()

      // First event
      fn.invoke({ name: 'test/reset', data: { seq: 1 }, ts: startTime, id: 'evt-1' })

      // Wait 200ms (less than period)
      await vi.advanceTimersByTimeAsync(200)

      // Second event (resets timer)
      fn.invoke({ name: 'test/reset', data: { seq: 2 }, ts: Date.now(), id: 'evt-2' })

      // Wait another 200ms
      await vi.advanceTimersByTimeAsync(200)

      // Should not have executed yet (timer was reset)
      expect(executionTimes.length).toBe(0)

      // Wait for debounce to complete
      await vi.advanceTimersByTimeAsync(150)

      expect(executionTimes.length).toBe(1)
    })
  })

  describe('Debounce by Key', () => {
    it('should debounce separately by key', async () => {
      const executedKeys: string[] = []

      const fn = inngest.createDebouncedFunction(
        {
          id: 'keyed-debounce',
          debounce: {
            key: 'event.data.userId',
            period: '200ms',
          },
        },
        { event: 'user/update' },
        async ({ event }) => {
          executedKeys.push(event.data.userId as string)
        }
      )

      // Events for user-1
      fn.invoke({ name: 'user/update', data: { userId: 'user-1', action: 'a' }, ts: Date.now(), id: 'evt-1' })
      fn.invoke({ name: 'user/update', data: { userId: 'user-1', action: 'b' }, ts: Date.now(), id: 'evt-2' })

      // Events for user-2
      fn.invoke({ name: 'user/update', data: { userId: 'user-2', action: 'x' }, ts: Date.now(), id: 'evt-3' })
      fn.invoke({ name: 'user/update', data: { userId: 'user-2', action: 'y' }, ts: Date.now(), id: 'evt-4' })

      // Advance past debounce
      await vi.advanceTimersByTimeAsync(250)

      // Both users should trigger separately
      expect(executedKeys).toContain('user-1')
      expect(executedKeys).toContain('user-2')
      expect(executedKeys.length).toBe(2)
    })

    it('should not cross-contaminate different keys', async () => {
      const results: Record<string, number> = {}

      const fn = inngest.createDebouncedFunction(
        {
          id: 'isolated-debounce',
          debounce: {
            key: 'event.data.tenantId',
            period: '300ms',
          },
        },
        { event: 'tenant/activity' },
        async ({ events }) => {
          const tenantId = events[0].data.tenantId as string
          results[tenantId] = events.length
        }
      )

      // Tenant A: 3 events
      for (let i = 0; i < 3; i++) {
        fn.invoke({
          name: 'tenant/activity',
          data: { tenantId: 'tenant-A', value: i },
          ts: Date.now(),
          id: `a-${i}`,
        })
      }

      // Tenant B: 5 events
      for (let i = 0; i < 5; i++) {
        fn.invoke({
          name: 'tenant/activity',
          data: { tenantId: 'tenant-B', value: i },
          ts: Date.now(),
          id: `b-${i}`,
        })
      }

      await vi.advanceTimersByTimeAsync(350)

      expect(results['tenant-A']).toBe(3)
      expect(results['tenant-B']).toBe(5)
    })
  })

  describe('Debounce Timeout', () => {
    it('should force execution at max timeout', async () => {
      let executionCount = 0
      let eventsAtExecution = 0

      const fn = inngest.createDebouncedFunction(
        {
          id: 'timeout-debounce',
          debounce: {
            period: '200ms',
            timeout: '1s', // Force after 1 second even if events keep coming
          },
        },
        { event: 'continuous/events' },
        async ({ events }) => {
          executionCount++
          eventsAtExecution = events.length
        }
      )

      // Send events continuously, resetting the debounce each time
      for (let i = 0; i < 20; i++) {
        fn.invoke({
          name: 'continuous/events',
          data: { seq: i },
          ts: Date.now(),
          id: `evt-${i}`,
        })
        await vi.advanceTimersByTimeAsync(100) // 100ms between each
      }

      // Should have executed at least once due to timeout
      expect(executionCount).toBeGreaterThanOrEqual(1)
      // First execution should have ~10 events (1s / 100ms)
      expect(eventsAtExecution).toBeGreaterThanOrEqual(10)
    })

    it('should respect timeout even with rapid resets', async () => {
      let forcedExecution = false

      const fn = inngest.createDebouncedFunction(
        {
          id: 'force-timeout',
          debounce: {
            period: '500ms',
            timeout: '300ms', // Timeout shorter than period
          },
        },
        { event: 'force/test' },
        async () => {
          forcedExecution = true
        }
      )

      fn.invoke({ name: 'force/test', data: {}, ts: Date.now(), id: 'evt-1' })

      // Advance 250ms and send another (normally would reset)
      await vi.advanceTimersByTimeAsync(250)
      fn.invoke({ name: 'force/test', data: {}, ts: Date.now(), id: 'evt-2' })

      // At this point, 250ms have passed, but period (500ms) hasn't elapsed
      // However, timeout (300ms) should trigger soon
      await vi.advanceTimersByTimeAsync(100)

      // Should have been forced by timeout
      expect(forcedExecution).toBe(true)
    })
  })

  describe('Event Accumulation', () => {
    it('should accumulate all debounced events', async () => {
      let accumulatedData: unknown[] = []

      const fn = inngest.createDebouncedFunction(
        {
          id: 'accumulate-debounce',
          debounce: { period: '200ms' },
        },
        { event: 'data/update' },
        async ({ events }) => {
          accumulatedData = events.map((e) => e.data)
        }
      )

      fn.invoke({ name: 'data/update', data: { field: 'name', value: 'Alice' }, ts: Date.now(), id: 'evt-1' })
      fn.invoke({ name: 'data/update', data: { field: 'email', value: 'alice@test.com' }, ts: Date.now(), id: 'evt-2' })
      fn.invoke({ name: 'data/update', data: { field: 'age', value: 30 }, ts: Date.now(), id: 'evt-3' })

      await vi.advanceTimersByTimeAsync(250)

      expect(accumulatedData).toEqual([
        { field: 'name', value: 'Alice' },
        { field: 'email', value: 'alice@test.com' },
        { field: 'age', value: 30 },
      ])
    })

    it('should preserve event order in accumulation', async () => {
      let eventOrder: number[] = []

      const fn = inngest.createDebouncedFunction(
        {
          id: 'order-debounce',
          debounce: { period: '100ms' },
        },
        { event: 'order/test' },
        async ({ events }) => {
          eventOrder = events.map((e) => e.data.seq as number)
        }
      )

      for (let i = 1; i <= 10; i++) {
        fn.invoke({ name: 'order/test', data: { seq: i }, ts: Date.now(), id: `evt-${i}` })
      }

      await vi.advanceTimersByTimeAsync(150)

      expect(eventOrder).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    })

    it('should provide first event as primary event', async () => {
      let primaryEvent: DebouncedEvent | null = null

      const fn = inngest.createDebouncedFunction(
        {
          id: 'primary-debounce',
          debounce: { period: '100ms' },
        },
        { event: 'primary/test' },
        async ({ event }) => {
          primaryEvent = event
        }
      )

      fn.invoke({ name: 'primary/test', data: { first: true }, ts: 1000, id: 'evt-first' })
      fn.invoke({ name: 'primary/test', data: { first: false }, ts: 2000, id: 'evt-second' })

      await vi.advanceTimersByTimeAsync(150)

      expect(primaryEvent?.id).toBe('evt-first')
      expect(primaryEvent?.data).toEqual({ first: true })
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty key path gracefully', async () => {
      let executed = false

      const fn = inngest.createDebouncedFunction(
        {
          id: 'empty-key-debounce',
          debounce: {
            key: 'event.data.missing.path',
            period: '100ms',
          },
        },
        { event: 'edge/test' },
        async () => {
          executed = true
        }
      )

      fn.invoke({ name: 'edge/test', data: {}, ts: Date.now(), id: 'evt-1' })

      await vi.advanceTimersByTimeAsync(150)

      expect(executed).toBe(true)
    })

    it('should handle very short debounce periods', async () => {
      let count = 0

      const fn = inngest.createDebouncedFunction(
        {
          id: 'short-debounce',
          debounce: { period: '10ms' },
        },
        { event: 'short/test' },
        async () => {
          count++
        }
      )

      fn.invoke({ name: 'short/test', data: {}, ts: Date.now(), id: 'evt-1' })
      await vi.advanceTimersByTimeAsync(5)
      fn.invoke({ name: 'short/test', data: {}, ts: Date.now(), id: 'evt-2' })
      await vi.advanceTimersByTimeAsync(5)
      fn.invoke({ name: 'short/test', data: {}, ts: Date.now(), id: 'evt-3' })

      await vi.advanceTimersByTimeAsync(20)

      // Should have executed at least once
      expect(count).toBeGreaterThanOrEqual(1)
    })

    it('should handle concurrent different debounce keys', async () => {
      const completedKeys = new Set<string>()

      const fn = inngest.createDebouncedFunction(
        {
          id: 'concurrent-debounce',
          debounce: {
            key: 'event.data.region',
            period: '150ms',
          },
        },
        { event: 'region/activity' },
        async ({ event }) => {
          completedKeys.add(event.data.region as string)
        }
      )

      // Fire events for 3 different regions at different times
      fn.invoke({ name: 'region/activity', data: { region: 'us-west' }, ts: Date.now(), id: 'evt-1' })

      await vi.advanceTimersByTimeAsync(50)
      fn.invoke({ name: 'region/activity', data: { region: 'us-east' }, ts: Date.now(), id: 'evt-2' })

      await vi.advanceTimersByTimeAsync(50)
      fn.invoke({ name: 'region/activity', data: { region: 'eu-west' }, ts: Date.now(), id: 'evt-3' })

      // Advance enough for all to complete
      await vi.advanceTimersByTimeAsync(200)

      expect(completedKeys.has('us-west')).toBe(true)
      expect(completedKeys.has('us-east')).toBe(true)
      expect(completedKeys.has('eu-west')).toBe(true)
    })

    it('should not leak memory from cleared debounces', async () => {
      const fn = inngest.createDebouncedFunction(
        {
          id: 'memory-test',
          debounce: { period: '100ms' },
        },
        { event: 'memory/test' },
        async () => {}
      )

      // Create many debounces
      for (let i = 0; i < 100; i++) {
        fn.invoke({ name: 'memory/test', data: { i }, ts: Date.now(), id: `evt-${i}` })
      }

      // Clear before they execute
      inngest.clearDebounces()

      // Advance time
      await vi.advanceTimersByTimeAsync(200)

      // Check no pending debounces
      expect(inngest.getPendingDebounceCount('memory-test')).toBe(0)
    })
  })

  describe('Debounce with Different Durations', () => {
    it('should parse string durations correctly', async () => {
      const durations = ['100ms', '1s', '5m', '1h']
      const results: Record<string, boolean> = {}

      for (const duration of durations) {
        const fn = inngest.createDebouncedFunction(
          {
            id: `duration-${duration}`,
            debounce: { period: duration },
          },
          { event: `duration/${duration}` },
          async () => {
            results[duration] = true
          }
        )

        fn.invoke({ name: `duration/${duration}`, data: {}, ts: Date.now(), id: `evt-${duration}` })
      }

      // Advance 100ms - should trigger 100ms
      await vi.advanceTimersByTimeAsync(150)
      expect(results['100ms']).toBe(true)

      // Advance to 1s - should trigger 1s
      await vi.advanceTimersByTimeAsync(1000)
      expect(results['1s']).toBe(true)

      // We won't wait for 5m and 1h in tests
    })

    it('should handle numeric durations', async () => {
      let executed = false

      const fn = inngest.createDebouncedFunction(
        {
          id: 'numeric-duration',
          debounce: { period: 250 }, // 250ms as number
        },
        { event: 'numeric/test' },
        async () => {
          executed = true
        }
      )

      fn.invoke({ name: 'numeric/test', data: {}, ts: Date.now(), id: 'evt-1' })

      await vi.advanceTimersByTimeAsync(200)
      expect(executed).toBe(false)

      await vi.advanceTimersByTimeAsync(100)
      expect(executed).toBe(true)
    })
  })

  describe('Real-World Scenarios', () => {
    it('should debounce search input', async () => {
      let searchQuery = ''
      let searchCount = 0

      const fn = inngest.createDebouncedFunction(
        {
          id: 'search-debounce',
          debounce: { period: '300ms' },
        },
        { event: 'search/query' },
        async ({ events }) => {
          // Use the last search query
          const lastEvent = events[events.length - 1]
          searchQuery = lastEvent.data.query as string
          searchCount++
        }
      )

      // Simulate typing "hello"
      fn.invoke({ name: 'search/query', data: { query: 'h' }, ts: Date.now(), id: 'q-1' })
      await vi.advanceTimersByTimeAsync(50)

      fn.invoke({ name: 'search/query', data: { query: 'he' }, ts: Date.now(), id: 'q-2' })
      await vi.advanceTimersByTimeAsync(50)

      fn.invoke({ name: 'search/query', data: { query: 'hel' }, ts: Date.now(), id: 'q-3' })
      await vi.advanceTimersByTimeAsync(50)

      fn.invoke({ name: 'search/query', data: { query: 'hell' }, ts: Date.now(), id: 'q-4' })
      await vi.advanceTimersByTimeAsync(50)

      fn.invoke({ name: 'search/query', data: { query: 'hello' }, ts: Date.now(), id: 'q-5' })

      // Wait for debounce
      await vi.advanceTimersByTimeAsync(350)

      expect(searchCount).toBe(1)
      expect(searchQuery).toBe('hello')
    })

    it('should debounce form autosave', async () => {
      const savedStates: unknown[] = []

      const fn = inngest.createDebouncedFunction(
        {
          id: 'autosave-debounce',
          debounce: {
            key: 'event.data.formId',
            period: '500ms',
            timeout: '5s',
          },
        },
        { event: 'form/change' },
        async ({ events }) => {
          // Merge all changes
          const merged = events.reduce(
            (acc, e) => ({ ...acc, ...(e.data.changes as object) }),
            {}
          )
          savedStates.push({ formId: events[0].data.formId, changes: merged })
        }
      )

      // User editing form A
      fn.invoke({
        name: 'form/change',
        data: { formId: 'form-A', changes: { name: 'Alice' } },
        ts: Date.now(),
        id: 'f-1',
      })
      await vi.advanceTimersByTimeAsync(100)

      fn.invoke({
        name: 'form/change',
        data: { formId: 'form-A', changes: { email: 'alice@test.com' } },
        ts: Date.now(),
        id: 'f-2',
      })
      await vi.advanceTimersByTimeAsync(100)

      fn.invoke({
        name: 'form/change',
        data: { formId: 'form-A', changes: { phone: '555-1234' } },
        ts: Date.now(),
        id: 'f-3',
      })

      await vi.advanceTimersByTimeAsync(600)

      expect(savedStates.length).toBe(1)
      expect(savedStates[0]).toEqual({
        formId: 'form-A',
        changes: {
          name: 'Alice',
          email: 'alice@test.com',
          phone: '555-1234',
        },
      })
    })

    it('should debounce webhook delivery retries', async () => {
      let deliveryAttempts = 0
      let lastPayload: unknown = null

      const fn = inngest.createDebouncedFunction(
        {
          id: 'webhook-debounce',
          debounce: {
            key: 'event.data.webhookId',
            period: '1s',
            timeout: '10s',
          },
        },
        { event: 'webhook/deliver' },
        async ({ events }) => {
          deliveryAttempts++
          // Use the most recent payload
          lastPayload = events[events.length - 1].data.payload
        }
      )

      // Multiple updates to same webhook
      fn.invoke({
        name: 'webhook/deliver',
        data: { webhookId: 'wh-1', payload: { count: 1 } },
        ts: Date.now(),
        id: 'd-1',
      })
      await vi.advanceTimersByTimeAsync(200)

      fn.invoke({
        name: 'webhook/deliver',
        data: { webhookId: 'wh-1', payload: { count: 2 } },
        ts: Date.now(),
        id: 'd-2',
      })
      await vi.advanceTimersByTimeAsync(200)

      fn.invoke({
        name: 'webhook/deliver',
        data: { webhookId: 'wh-1', payload: { count: 3 } },
        ts: Date.now(),
        id: 'd-3',
      })

      await vi.advanceTimersByTimeAsync(1100)

      // Should only deliver once with latest payload
      expect(deliveryAttempts).toBe(1)
      expect(lastPayload).toEqual({ count: 3 })
    })
  })
})
