/**
 * PollingScheduler tests
 *
 * RED phase: These tests define the expected behavior of PollingScheduler.
 * All tests should FAIL until implementation is complete.
 *
 * PollingScheduler provides rate-limited polling with state tracking:
 * - Poll interval configuration (fixed, dynamic)
 * - Rate limiting per source
 * - State persistence between polls (cursor, lastId, timestamp)
 * - Backoff on errors (exponential with jitter)
 * - Concurrent poll prevention
 * - Poll result deduplication
 * - Health check and metrics
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  PollingScheduler,
  createPollingScheduler,
  type PollConfig,
  type PollState,
  type PollResult,
  type PollHandler,
  type BackoffConfig,
  type RateLimitConfig,
  type HealthStatus,
  type PollMetrics,
} from '../polling-scheduler'

// ============================================================================
// TEST HELPERS
// ============================================================================

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface TestItem {
  id: string
  data: string
  timestamp: number
}

function createTestHandler(
  items: TestItem[] = [],
  options: { shouldFail?: boolean; failCount?: number; delayMs?: number } = {}
): PollHandler<TestItem> {
  let callCount = 0
  return async (state) => {
    callCount++
    if (options.delayMs) {
      await delay(options.delayMs)
    }
    if (options.shouldFail || (options.failCount && callCount <= options.failCount)) {
      throw new Error('Poll failed')
    }
    const cursor = state?.cursor ? parseInt(state.cursor, 10) : 0
    const newItems = items.filter((item) => parseInt(item.id, 10) > cursor)
    return {
      items: newItems,
      cursor: newItems.length > 0 ? newItems[newItems.length - 1]!.id : state?.cursor,
      hasMore: false,
    }
  }
}

// ============================================================================
// POLL INTERVAL CONFIGURATION
// ============================================================================

describe('PollingScheduler', () => {
  describe('poll interval configuration', () => {
    describe('fixed interval', () => {
      it('should poll at fixed intervals', async () => {
        const handler = vi.fn().mockResolvedValue({ items: [], hasMore: false })
        const scheduler = createPollingScheduler({
          sourceId: 'test-source',
          handler,
          interval: 100,
        })

        await scheduler.start()
        await delay(350)
        await scheduler.stop()

        // Should have polled 3-4 times in 350ms with 100ms interval
        expect(handler).toHaveBeenCalledTimes(expect.any(Number))
        expect(handler.mock.calls.length).toBeGreaterThanOrEqual(3)
        expect(handler.mock.calls.length).toBeLessThanOrEqual(4)
      })

      it('should support interval in milliseconds', async () => {
        const handler = vi.fn().mockResolvedValue({ items: [], hasMore: false })
        const scheduler = createPollingScheduler({
          sourceId: 'test-source',
          handler,
          interval: 50,
        })

        await scheduler.start()
        await delay(180)
        await scheduler.stop()

        expect(handler).toHaveBeenCalledTimes(expect.any(Number))
        expect(handler.mock.calls.length).toBeGreaterThanOrEqual(3)
      })

      it('should support interval as Duration string', async () => {
        const handler = vi.fn().mockResolvedValue({ items: [], hasMore: false })
        const scheduler = createPollingScheduler({
          sourceId: 'test-source',
          handler,
          interval: '100ms',
        })

        await scheduler.start()
        await delay(250)
        await scheduler.stop()

        expect(handler.mock.calls.length).toBeGreaterThanOrEqual(2)
      })

      it('should not drift over time', async () => {
        const callTimes: number[] = []
        const handler = vi.fn().mockImplementation(async () => {
          callTimes.push(Date.now())
          await delay(10) // Simulate some work
          return { items: [], hasMore: false }
        })

        const scheduler = createPollingScheduler({
          sourceId: 'test-source',
          handler,
          interval: 100,
        })

        await scheduler.start()
        await delay(550)
        await scheduler.stop()

        // Check that intervals are approximately consistent
        const intervals: number[] = []
        for (let i = 1; i < callTimes.length; i++) {
          intervals.push(callTimes[i]! - callTimes[i - 1]!)
        }

        // Average interval should be close to 100ms (within 20ms tolerance)
        if (intervals.length > 0) {
          const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length
          expect(avgInterval).toBeGreaterThanOrEqual(80)
          expect(avgInterval).toBeLessThanOrEqual(120)
        }
      })
    })

    describe('dynamic interval', () => {
      it('should support dynamic interval based on result', async () => {
        let pollCount = 0
        const handler = vi.fn().mockImplementation(async () => {
          pollCount++
          return { items: [], hasMore: pollCount < 3 }
        })

        const scheduler = createPollingScheduler({
          sourceId: 'test-source',
          handler,
          interval: (result) => (result.hasMore ? 50 : 200),
        })

        await scheduler.start()
        await delay(400)
        await scheduler.stop()

        // First polls should be fast, then slow down
        expect(handler.mock.calls.length).toBeGreaterThanOrEqual(3)
      })

      it('should support dynamic interval based on state', async () => {
        const handler = vi.fn().mockResolvedValue({ items: [], hasMore: false })
        let intervalCallCount = 0

        const scheduler = createPollingScheduler({
          sourceId: 'test-source',
          handler,
          interval: (_result, state) => {
            intervalCallCount++
            return state?.consecutiveEmptyPolls && state.consecutiveEmptyPolls > 2 ? 200 : 50
          },
        })

        await scheduler.start()
        await delay(350)
        await scheduler.stop()

        expect(intervalCallCount).toBeGreaterThan(0)
      })

      it('should clamp dynamic interval to min/max bounds', async () => {
        const handler = vi.fn().mockResolvedValue({ items: [], hasMore: true })

        const scheduler = createPollingScheduler({
          sourceId: 'test-source',
          handler,
          interval: () => 10, // Would be too fast
          minInterval: 50,
          maxInterval: 1000,
        })

        await scheduler.start()
        await delay(200)
        await scheduler.stop()

        // Should have polled at most 4 times with 50ms min interval
        expect(handler.mock.calls.length).toBeLessThanOrEqual(5)
      })
    })

    describe('interval configuration validation', () => {
      it('should throw on negative interval', () => {
        expect(() =>
          createPollingScheduler({
            sourceId: 'test-source',
            handler: async () => ({ items: [], hasMore: false }),
            interval: -100,
          })
        ).toThrow()
      })

      it('should throw on zero interval', () => {
        expect(() =>
          createPollingScheduler({
            sourceId: 'test-source',
            handler: async () => ({ items: [], hasMore: false }),
            interval: 0,
          })
        ).toThrow()
      })

      it('should throw when minInterval > maxInterval', () => {
        expect(() =>
          createPollingScheduler({
            sourceId: 'test-source',
            handler: async () => ({ items: [], hasMore: false }),
            interval: 100,
            minInterval: 500,
            maxInterval: 100,
          })
        ).toThrow()
      })
    })
  })

  // ============================================================================
  // RATE LIMITING PER SOURCE
  // ============================================================================

  describe('rate limiting per source', () => {
    it('should enforce requests per second limit', async () => {
      const handler = vi.fn().mockResolvedValue({ items: [], hasMore: true })

      const scheduler = createPollingScheduler({
        sourceId: 'test-source',
        handler,
        interval: 10, // Would be 100 RPS without limiting
        rateLimit: {
          requestsPerSecond: 5,
        },
      })

      await scheduler.start()
      await delay(1000)
      await scheduler.stop()

      // Should have at most ~5 calls in 1 second
      expect(handler.mock.calls.length).toBeLessThanOrEqual(7)
    })

    it('should enforce requests per minute limit', async () => {
      const handler = vi.fn().mockResolvedValue({ items: [], hasMore: true })

      const scheduler = createPollingScheduler({
        sourceId: 'test-source',
        handler,
        interval: 10,
        rateLimit: {
          requestsPerMinute: 120, // 2 per second
        },
      })

      await scheduler.start()
      await delay(500)
      await scheduler.stop()

      // Should have at most 2-3 calls in 500ms (2/s = 1 per 500ms + buffer)
      expect(handler.mock.calls.length).toBeLessThanOrEqual(4)
    })

    it('should use token bucket algorithm', async () => {
      const callTimes: number[] = []
      const handler = vi.fn().mockImplementation(async () => {
        callTimes.push(Date.now())
        return { items: [], hasMore: true }
      })

      const scheduler = createPollingScheduler({
        sourceId: 'test-source',
        handler,
        interval: 1,
        rateLimit: {
          requestsPerSecond: 10,
          burstSize: 3, // Allow burst of 3
        },
      })

      await scheduler.start()
      await delay(100)
      await scheduler.stop()

      // Initial burst should be fast, then rate limited
      if (callTimes.length >= 4) {
        const firstThreeInterval = callTimes[2]! - callTimes[0]!
        const afterBurstInterval = callTimes[3]! - callTimes[2]!
        expect(firstThreeInterval).toBeLessThan(afterBurstInterval)
      }
    })

    it('should support separate rate limits per source', async () => {
      const handler1 = vi.fn().mockResolvedValue({ items: [], hasMore: true })
      const handler2 = vi.fn().mockResolvedValue({ items: [], hasMore: true })

      const scheduler1 = createPollingScheduler({
        sourceId: 'source-1',
        handler: handler1,
        interval: 10,
        rateLimit: { requestsPerSecond: 5 },
      })

      const scheduler2 = createPollingScheduler({
        sourceId: 'source-2',
        handler: handler2,
        interval: 10,
        rateLimit: { requestsPerSecond: 10 },
      })

      await Promise.all([scheduler1.start(), scheduler2.start()])
      await delay(500)
      await Promise.all([scheduler1.stop(), scheduler2.stop()])

      // Source 2 should have roughly 2x the calls
      expect(handler2.mock.calls.length).toBeGreaterThan(handler1.mock.calls.length)
    })

    it('should track rate limit state', async () => {
      const handler = vi.fn().mockResolvedValue({ items: [], hasMore: true })

      const scheduler = createPollingScheduler({
        sourceId: 'test-source',
        handler,
        interval: 10,
        rateLimit: { requestsPerSecond: 5 },
      })

      await scheduler.start()
      await delay(200)

      const rateLimitState = scheduler.getRateLimitState()
      expect(rateLimitState).toBeDefined()
      expect(rateLimitState.tokensRemaining).toBeDefined()
      expect(rateLimitState.nextRefillAt).toBeDefined()

      await scheduler.stop()
    })

    it('should emit rate limit events', async () => {
      const rateLimitEvents: any[] = []
      const handler = vi.fn().mockResolvedValue({ items: [], hasMore: true })

      const scheduler = createPollingScheduler({
        sourceId: 'test-source',
        handler,
        interval: 1,
        rateLimit: { requestsPerSecond: 2 },
        onRateLimited: (event) => {
          rateLimitEvents.push(event)
        },
      })

      await scheduler.start()
      await delay(200)
      await scheduler.stop()

      // Should have been rate limited at least once
      expect(rateLimitEvents.length).toBeGreaterThan(0)
    })
  })

  // ============================================================================
  // STATE PERSISTENCE BETWEEN POLLS
  // ============================================================================

  describe('state persistence between polls', () => {
    describe('cursor tracking', () => {
      it('should persist cursor between polls', async () => {
        const states: (PollState | undefined)[] = []
        const handler = vi.fn().mockImplementation(async (state: PollState | undefined) => {
          states.push(state)
          return {
            items: [{ id: '1', data: 'test', timestamp: Date.now() }],
            cursor: 'cursor-1',
            hasMore: false,
          }
        })

        const scheduler = createPollingScheduler({
          sourceId: 'test-source',
          handler,
          interval: 50,
        })

        await scheduler.start()
        await delay(150)
        await scheduler.stop()

        // Second call should have cursor from first call
        expect(states.length).toBeGreaterThan(1)
        expect(states[1]?.cursor).toBe('cursor-1')
      })

      it('should use initial cursor from config', async () => {
        let receivedState: PollState | undefined
        const handler = vi.fn().mockImplementation(async (state: PollState | undefined) => {
          receivedState = state
          return { items: [], cursor: 'new-cursor', hasMore: false }
        })

        const scheduler = createPollingScheduler({
          sourceId: 'test-source',
          handler,
          interval: 100,
          initialState: {
            cursor: 'initial-cursor',
          },
        })

        await scheduler.start()
        await delay(50)
        await scheduler.stop()

        expect(receivedState?.cursor).toBe('initial-cursor')
      })

      it('should update cursor progressively', async () => {
        let pollCount = 0
        const handler = vi.fn().mockImplementation(async () => {
          pollCount++
          return {
            items: [{ id: `${pollCount}`, data: 'test', timestamp: Date.now() }],
            cursor: `cursor-${pollCount}`,
            hasMore: false,
          }
        })

        const scheduler = createPollingScheduler({
          sourceId: 'test-source',
          handler,
          interval: 50,
        })

        await scheduler.start()
        await delay(200)
        await scheduler.stop()

        const state = scheduler.getState()
        expect(state.cursor).toMatch(/cursor-\d+/)
      })
    })

    describe('lastId tracking', () => {
      it('should track lastId from results', async () => {
        const handler = vi.fn().mockResolvedValue({
          items: [
            { id: '100', data: 'test1', timestamp: Date.now() },
            { id: '101', data: 'test2', timestamp: Date.now() },
          ],
          hasMore: false,
        })

        const scheduler = createPollingScheduler({
          sourceId: 'test-source',
          handler,
          interval: 100,
          trackLastId: true,
          getItemId: (item: TestItem) => item.id,
        })

        await scheduler.start()
        await delay(50)
        await scheduler.stop()

        expect(scheduler.getState().lastId).toBe('101')
      })

      it('should persist lastId across polls', async () => {
        const states: (PollState | undefined)[] = []
        let pollCount = 0
        const handler = vi.fn().mockImplementation(async (state: PollState | undefined) => {
          states.push(state)
          pollCount++
          return {
            items: [{ id: `${pollCount * 100}`, data: 'test', timestamp: Date.now() }],
            hasMore: false,
          }
        })

        const scheduler = createPollingScheduler({
          sourceId: 'test-source',
          handler,
          interval: 50,
          trackLastId: true,
          getItemId: (item: TestItem) => item.id,
        })

        await scheduler.start()
        await delay(150)
        await scheduler.stop()

        expect(states.length).toBeGreaterThan(1)
        expect(states[1]?.lastId).toBe('100')
      })
    })

    describe('timestamp tracking', () => {
      it('should track last poll timestamp', async () => {
        const handler = vi.fn().mockResolvedValue({ items: [], hasMore: false })

        const scheduler = createPollingScheduler({
          sourceId: 'test-source',
          handler,
          interval: 100,
        })

        const beforePoll = Date.now()
        await scheduler.start()
        await delay(50)
        await scheduler.stop()
        const afterPoll = Date.now()

        const state = scheduler.getState()
        expect(state.lastPollTimestamp).toBeGreaterThanOrEqual(beforePoll)
        expect(state.lastPollTimestamp).toBeLessThanOrEqual(afterPoll)
      })

      it('should track last successful poll timestamp', async () => {
        let shouldFail = true
        const handler = vi.fn().mockImplementation(async () => {
          if (shouldFail) {
            shouldFail = false
            throw new Error('First poll fails')
          }
          return { items: [], hasMore: false }
        })

        const scheduler = createPollingScheduler({
          sourceId: 'test-source',
          handler,
          interval: 50,
          backoff: { initialDelayMs: 10 },
        })

        await scheduler.start()
        await delay(200)
        await scheduler.stop()

        const state = scheduler.getState()
        expect(state.lastSuccessTimestamp).toBeDefined()
        expect(state.lastSuccessTimestamp).toBeGreaterThan(0)
      })

      it('should support timestamp-based polling', async () => {
        let lastTimestamp: number | undefined
        const handler = vi.fn().mockImplementation(async (state: PollState | undefined) => {
          lastTimestamp = state?.lastItemTimestamp
          return {
            items: [{ id: '1', data: 'test', timestamp: 1000000 }],
            lastItemTimestamp: 1000000,
            hasMore: false,
          }
        })

        const scheduler = createPollingScheduler({
          sourceId: 'test-source',
          handler,
          interval: 50,
        })

        await scheduler.start()
        await delay(150)
        await scheduler.stop()

        expect(lastTimestamp).toBe(1000000)
      })
    })

    describe('state serialization', () => {
      it('should serialize state to JSON', async () => {
        const handler = vi.fn().mockResolvedValue({
          items: [{ id: '1', data: 'test', timestamp: Date.now() }],
          cursor: 'test-cursor',
          hasMore: false,
        })

        const scheduler = createPollingScheduler({
          sourceId: 'test-source',
          handler,
          interval: 100,
        })

        await scheduler.start()
        await delay(50)
        await scheduler.stop()

        const serialized = scheduler.serializeState()
        expect(typeof serialized).toBe('string')
        const parsed = JSON.parse(serialized)
        expect(parsed.cursor).toBe('test-cursor')
      })

      it('should restore state from JSON', async () => {
        const savedState = JSON.stringify({
          cursor: 'saved-cursor',
          lastId: 'saved-id',
          lastPollTimestamp: Date.now() - 10000,
        })

        let receivedState: PollState | undefined
        const handler = vi.fn().mockImplementation(async (state: PollState | undefined) => {
          receivedState = state
          return { items: [], hasMore: false }
        })

        const scheduler = createPollingScheduler({
          sourceId: 'test-source',
          handler,
          interval: 100,
        })

        scheduler.restoreState(savedState)
        await scheduler.start()
        await delay(50)
        await scheduler.stop()

        expect(receivedState?.cursor).toBe('saved-cursor')
        expect(receivedState?.lastId).toBe('saved-id')
      })

      it('should handle corrupted state gracefully', async () => {
        const handler = vi.fn().mockResolvedValue({ items: [], hasMore: false })

        const scheduler = createPollingScheduler({
          sourceId: 'test-source',
          handler,
          interval: 100,
        })

        // Should not throw on invalid JSON
        expect(() => scheduler.restoreState('invalid json {')).not.toThrow()

        await scheduler.start()
        await delay(50)
        await scheduler.stop()

        expect(handler).toHaveBeenCalled()
      })
    })

    describe('custom state fields', () => {
      it('should support custom state fields', async () => {
        const states: PollState[] = []
        const handler = vi.fn().mockImplementation(async (state: PollState | undefined) => {
          if (state) states.push(state)
          return {
            items: [],
            hasMore: false,
            customState: {
              pageToken: 'next-page',
              syncToken: 'sync-123',
            },
          }
        })

        const scheduler = createPollingScheduler({
          sourceId: 'test-source',
          handler,
          interval: 50,
        })

        await scheduler.start()
        await delay(150)
        await scheduler.stop()

        expect(states.length).toBeGreaterThan(0)
        expect(states[0]!.customState?.pageToken).toBe('next-page')
      })
    })
  })

  // ============================================================================
  // BACKOFF ON ERRORS
  // ============================================================================

  describe('backoff on errors', () => {
    describe('exponential backoff', () => {
      it('should increase delay exponentially on consecutive errors', async () => {
        const callTimes: number[] = []
        const handler = vi.fn().mockImplementation(async () => {
          callTimes.push(Date.now())
          throw new Error('Always fails')
        })

        const scheduler = createPollingScheduler({
          sourceId: 'test-source',
          handler,
          interval: 50,
          backoff: {
            initialDelayMs: 50,
            maxDelayMs: 1000,
            multiplier: 2,
          },
        })

        await scheduler.start()
        await delay(500)
        await scheduler.stop()

        // Verify exponential increase
        if (callTimes.length >= 3) {
          const interval1 = callTimes[1]! - callTimes[0]!
          const interval2 = callTimes[2]! - callTimes[1]!
          // Second interval should be roughly double (allowing for timing variance)
          expect(interval2).toBeGreaterThan(interval1 * 1.5)
        }
      })

      it('should cap at max delay', async () => {
        const callTimes: number[] = []
        const handler = vi.fn().mockImplementation(async () => {
          callTimes.push(Date.now())
          throw new Error('Always fails')
        })

        const scheduler = createPollingScheduler({
          sourceId: 'test-source',
          handler,
          interval: 10,
          backoff: {
            initialDelayMs: 50,
            maxDelayMs: 100,
            multiplier: 2,
          },
        })

        await scheduler.start()
        await delay(600)
        await scheduler.stop()

        // Later intervals should not exceed max
        if (callTimes.length >= 4) {
          const laterInterval = callTimes[callTimes.length - 1]! - callTimes[callTimes.length - 2]!
          expect(laterInterval).toBeLessThanOrEqual(150) // 100ms max + some variance
        }
      })

      it('should reset backoff on successful poll', async () => {
        let failCount = 3
        const callTimes: number[] = []
        const handler = vi.fn().mockImplementation(async () => {
          callTimes.push(Date.now())
          if (failCount > 0) {
            failCount--
            throw new Error('Fails first 3 times')
          }
          return { items: [], hasMore: false }
        })

        const scheduler = createPollingScheduler({
          sourceId: 'test-source',
          handler,
          interval: 50,
          backoff: {
            initialDelayMs: 50,
            multiplier: 2,
          },
        })

        await scheduler.start()
        await delay(600)
        await scheduler.stop()

        // After success, interval should return to normal
        const state = scheduler.getState()
        expect(state.consecutiveErrors).toBe(0)
      })
    })

    describe('jitter', () => {
      it('should add jitter to backoff delay', async () => {
        const callTimes: number[] = []
        const handler = vi.fn().mockImplementation(async () => {
          callTimes.push(Date.now())
          throw new Error('Always fails')
        })

        const scheduler = createPollingScheduler({
          sourceId: 'test-source',
          handler,
          interval: 50,
          backoff: {
            initialDelayMs: 100,
            multiplier: 1, // No multiplier to isolate jitter effect
            jitter: 0.5, // 50% jitter
          },
        })

        await scheduler.start()
        await delay(600)
        await scheduler.stop()

        // With jitter, intervals should vary
        if (callTimes.length >= 4) {
          const intervals = []
          for (let i = 1; i < callTimes.length; i++) {
            intervals.push(callTimes[i]! - callTimes[i - 1]!)
          }
          // Not all intervals should be exactly the same
          const uniqueIntervals = new Set(intervals.map((i) => Math.round(i / 10) * 10))
          // With 50% jitter on 100ms, expect some variance
          expect(intervals.some((i) => i >= 50 && i <= 150)).toBe(true)
        }
      })

      it('should support full jitter strategy', async () => {
        const handler = vi.fn().mockRejectedValue(new Error('Fails'))

        const scheduler = createPollingScheduler({
          sourceId: 'test-source',
          handler,
          interval: 50,
          backoff: {
            initialDelayMs: 100,
            jitter: 1.0, // Full jitter
            strategy: 'full',
          },
        })

        await scheduler.start()
        await delay(200)
        await scheduler.stop()

        // Should have handled the jitter without errors
        expect(handler).toHaveBeenCalled()
      })

      it('should support decorrelated jitter strategy', async () => {
        const handler = vi.fn().mockRejectedValue(new Error('Fails'))

        const scheduler = createPollingScheduler({
          sourceId: 'test-source',
          handler,
          interval: 50,
          backoff: {
            initialDelayMs: 100,
            strategy: 'decorrelated',
          },
        })

        await scheduler.start()
        await delay(200)
        await scheduler.stop()

        expect(handler).toHaveBeenCalled()
      })
    })

    describe('error tracking', () => {
      it('should track consecutive error count', async () => {
        const handler = vi.fn().mockRejectedValue(new Error('Fails'))

        const scheduler = createPollingScheduler({
          sourceId: 'test-source',
          handler,
          interval: 50,
          backoff: { initialDelayMs: 20 },
        })

        await scheduler.start()
        await delay(200)
        await scheduler.stop()

        const state = scheduler.getState()
        expect(state.consecutiveErrors).toBeGreaterThan(0)
      })

      it('should track last error', async () => {
        const handler = vi.fn().mockRejectedValue(new Error('Specific error message'))

        const scheduler = createPollingScheduler({
          sourceId: 'test-source',
          handler,
          interval: 100,
          backoff: { initialDelayMs: 20 },
        })

        await scheduler.start()
        await delay(50)
        await scheduler.stop()

        const state = scheduler.getState()
        expect(state.lastError).toBeDefined()
        expect(state.lastError?.message).toBe('Specific error message')
      })

      it('should emit error events', async () => {
        const errors: Error[] = []
        const handler = vi.fn().mockRejectedValue(new Error('Poll error'))

        const scheduler = createPollingScheduler({
          sourceId: 'test-source',
          handler,
          interval: 50,
          backoff: { initialDelayMs: 20 },
          onError: (error) => {
            errors.push(error)
          },
        })

        await scheduler.start()
        await delay(150)
        await scheduler.stop()

        expect(errors.length).toBeGreaterThan(0)
      })

      it('should give up after max retries', async () => {
        const handler = vi.fn().mockRejectedValue(new Error('Always fails'))
        let gaveUp = false

        const scheduler = createPollingScheduler({
          sourceId: 'test-source',
          handler,
          interval: 50,
          backoff: {
            initialDelayMs: 10,
            maxRetries: 3,
          },
          onGiveUp: () => {
            gaveUp = true
          },
        })

        await scheduler.start()
        await delay(300)
        await scheduler.stop()

        expect(gaveUp).toBe(true)
        expect(handler.mock.calls.length).toBeLessThanOrEqual(4)
      })
    })
  })

  // ============================================================================
  // CONCURRENT POLL PREVENTION
  // ============================================================================

  describe('concurrent poll prevention', () => {
    it('should not start new poll while one is in progress', async () => {
      let concurrentCalls = 0
      let maxConcurrent = 0
      const handler = vi.fn().mockImplementation(async () => {
        concurrentCalls++
        maxConcurrent = Math.max(maxConcurrent, concurrentCalls)
        await delay(100) // Long-running poll
        concurrentCalls--
        return { items: [], hasMore: false }
      })

      const scheduler = createPollingScheduler({
        sourceId: 'test-source',
        handler,
        interval: 20, // Faster than handler
      })

      await scheduler.start()
      await delay(300)
      await scheduler.stop()

      expect(maxConcurrent).toBe(1)
    })

    it('should queue next poll while current is running', async () => {
      let pollCount = 0
      const handler = vi.fn().mockImplementation(async () => {
        pollCount++
        await delay(100)
        return { items: [], hasMore: false }
      })

      const scheduler = createPollingScheduler({
        sourceId: 'test-source',
        handler,
        interval: 30,
      })

      await scheduler.start()
      await delay(250)
      await scheduler.stop()

      // Should have completed 2-3 polls sequentially
      expect(pollCount).toBeGreaterThanOrEqual(2)
      expect(pollCount).toBeLessThanOrEqual(3)
    })

    it('should report polling state', async () => {
      const handler = vi.fn().mockImplementation(async () => {
        await delay(100)
        return { items: [], hasMore: false }
      })

      const scheduler = createPollingScheduler({
        sourceId: 'test-source',
        handler,
        interval: 200,
      })

      await scheduler.start()
      await delay(50)

      expect(scheduler.isPolling()).toBe(true)

      await delay(100)
      expect(scheduler.isPolling()).toBe(false)

      await scheduler.stop()
    })

    it('should handle overlapping poll requests gracefully', async () => {
      const handler = vi.fn().mockImplementation(async () => {
        await delay(50)
        return { items: [], hasMore: false }
      })

      const scheduler = createPollingScheduler({
        sourceId: 'test-source',
        handler,
        interval: 100,
      })

      await scheduler.start()

      // Manually trigger polls while one is running
      const manualPolls = Promise.all([
        scheduler.pollNow(),
        scheduler.pollNow(),
        scheduler.pollNow(),
      ])

      await manualPolls
      await scheduler.stop()

      // Despite multiple triggers, should not have concurrent executions
      expect(handler.mock.calls.length).toBeLessThanOrEqual(4)
    })

    it('should support force poll that cancels current', async () => {
      let wasInterrupted = false
      const handler = vi.fn().mockImplementation(async () => {
        try {
          await delay(200)
          return { items: [], hasMore: false }
        } catch (e: any) {
          if (e.name === 'AbortError') wasInterrupted = true
          throw e
        }
      })

      const scheduler = createPollingScheduler({
        sourceId: 'test-source',
        handler,
        interval: 500,
        supportCancellation: true,
      })

      await scheduler.start()
      await delay(50)
      await scheduler.forcePoll()
      await scheduler.stop()

      // The first poll should have been interrupted
      expect(wasInterrupted || handler.mock.calls.length >= 2).toBe(true)
    })
  })

  // ============================================================================
  // POLL RESULT DEDUPLICATION
  // ============================================================================

  describe('poll result deduplication', () => {
    it('should deduplicate items by id', async () => {
      const processedItems: TestItem[] = []
      let pollCount = 0
      const handler = vi.fn().mockImplementation(async () => {
        pollCount++
        // Return overlapping items
        return {
          items: [
            { id: '1', data: 'item-1', timestamp: Date.now() },
            { id: '2', data: 'item-2', timestamp: Date.now() },
          ],
          hasMore: false,
        }
      })

      const scheduler = createPollingScheduler({
        sourceId: 'test-source',
        handler,
        interval: 50,
        deduplicate: true,
        getItemId: (item: TestItem) => item.id,
        onItems: (items) => {
          processedItems.push(...items)
        },
      })

      await scheduler.start()
      await delay(150)
      await scheduler.stop()

      // Should only have processed unique items
      const uniqueIds = new Set(processedItems.map((i) => i.id))
      expect(uniqueIds.size).toBe(processedItems.length)
    })

    it('should track seen items in sliding window', async () => {
      const processedIds: string[] = []
      let pollCount = 0
      const handler = vi.fn().mockImplementation(async () => {
        pollCount++
        return {
          items: [
            { id: `${pollCount}`, data: `item-${pollCount}`, timestamp: Date.now() },
            // Include item from 2 polls ago (should be deduped within window)
            ...(pollCount > 2
              ? [{ id: `${pollCount - 2}`, data: 'old', timestamp: Date.now() }]
              : []),
          ],
          hasMore: false,
        }
      })

      const scheduler = createPollingScheduler({
        sourceId: 'test-source',
        handler,
        interval: 30,
        deduplicate: true,
        dedupeWindowSize: 100,
        getItemId: (item: TestItem) => item.id,
        onItems: (items) => {
          processedIds.push(...items.map((i) => i.id))
        },
      })

      await scheduler.start()
      await delay(200)
      await scheduler.stop()

      // No duplicates in processed items
      const counts = new Map<string, number>()
      for (const id of processedIds) {
        counts.set(id, (counts.get(id) || 0) + 1)
      }
      for (const count of counts.values()) {
        expect(count).toBe(1)
      }
    })

    it('should expire old items from dedup cache', async () => {
      const processedIds: string[] = []
      let pollCount = 0
      const handler = vi.fn().mockImplementation(async () => {
        pollCount++
        if (pollCount === 1) {
          return { items: [{ id: '1', data: 'first', timestamp: Date.now() }], hasMore: false }
        }
        // After TTL expires, same item should be processed again
        return { items: [{ id: '1', data: 'again', timestamp: Date.now() }], hasMore: false }
      })

      const scheduler = createPollingScheduler({
        sourceId: 'test-source',
        handler,
        interval: 100,
        deduplicate: true,
        dedupeTtlMs: 50, // Short TTL
        getItemId: (item: TestItem) => item.id,
        onItems: (items) => {
          processedIds.push(...items.map((i) => i.id))
        },
      })

      await scheduler.start()
      await delay(300)
      await scheduler.stop()

      // Same item should have been processed multiple times after TTL
      const idOneCount = processedIds.filter((id) => id === '1').length
      expect(idOneCount).toBeGreaterThan(1)
    })

    it('should support custom dedup key function', async () => {
      const processedItems: TestItem[] = []
      const handler = vi.fn().mockImplementation(async () => ({
        items: [
          { id: '1', data: 'same-data', timestamp: 100 },
          { id: '2', data: 'same-data', timestamp: 100 }, // Different id but same data
        ],
        hasMore: false,
      }))

      const scheduler = createPollingScheduler({
        sourceId: 'test-source',
        handler,
        interval: 100,
        deduplicate: true,
        getDedupeKey: (item: TestItem) => `${item.data}-${item.timestamp}`,
        onItems: (items) => {
          processedItems.push(...items)
        },
      })

      await scheduler.start()
      await delay(50)
      await scheduler.stop()

      // Should have deduped by data+timestamp, so only one item
      expect(processedItems.length).toBe(1)
    })

    it('should report dedup stats', async () => {
      let pollCount = 0
      const handler = vi.fn().mockImplementation(async () => {
        pollCount++
        return {
          items: [
            { id: '1', data: 'always-same', timestamp: Date.now() },
            { id: `new-${pollCount}`, data: 'unique', timestamp: Date.now() },
          ],
          hasMore: false,
        }
      })

      const scheduler = createPollingScheduler({
        sourceId: 'test-source',
        handler,
        interval: 50,
        deduplicate: true,
        getItemId: (item: TestItem) => item.id,
        onItems: () => {},
      })

      await scheduler.start()
      await delay(200)
      await scheduler.stop()

      const metrics = scheduler.getMetrics()
      expect(metrics.deduplicatedCount).toBeGreaterThan(0)
    })
  })

  // ============================================================================
  // HEALTH CHECK AND METRICS
  // ============================================================================

  describe('health check and metrics', () => {
    describe('health status', () => {
      it('should report healthy when polling successfully', async () => {
        const handler = vi.fn().mockResolvedValue({ items: [], hasMore: false })

        const scheduler = createPollingScheduler({
          sourceId: 'test-source',
          handler,
          interval: 50,
        })

        await scheduler.start()
        await delay(100)

        const health = scheduler.getHealth()
        expect(health.status).toBe('healthy')
        expect(health.isRunning).toBe(true)

        await scheduler.stop()
      })

      it('should report degraded after errors', async () => {
        let failCount = 2
        const handler = vi.fn().mockImplementation(async () => {
          if (failCount > 0) {
            failCount--
            throw new Error('Temporary failure')
          }
          return { items: [], hasMore: false }
        })

        const scheduler = createPollingScheduler({
          sourceId: 'test-source',
          handler,
          interval: 30,
          backoff: { initialDelayMs: 20 },
          healthThresholds: {
            degradedAfterErrors: 1,
          },
        })

        await scheduler.start()
        await delay(100)

        const health = scheduler.getHealth()
        expect(health.status).toBe('degraded')

        await scheduler.stop()
      })

      it('should report unhealthy after max consecutive errors', async () => {
        const handler = vi.fn().mockRejectedValue(new Error('Always fails'))

        const scheduler = createPollingScheduler({
          sourceId: 'test-source',
          handler,
          interval: 20,
          backoff: { initialDelayMs: 10 },
          healthThresholds: {
            unhealthyAfterErrors: 3,
          },
        })

        await scheduler.start()
        await delay(200)

        const health = scheduler.getHealth()
        expect(health.status).toBe('unhealthy')

        await scheduler.stop()
      })

      it('should include last error in health', async () => {
        const handler = vi.fn().mockRejectedValue(new Error('Database connection failed'))

        const scheduler = createPollingScheduler({
          sourceId: 'test-source',
          handler,
          interval: 100,
          backoff: { initialDelayMs: 10 },
        })

        await scheduler.start()
        await delay(50)
        await scheduler.stop()

        const health = scheduler.getHealth()
        expect(health.lastError).toBeDefined()
        expect(health.lastError?.message).toBe('Database connection failed')
      })

      it('should track time since last success', async () => {
        const handler = vi.fn().mockResolvedValue({ items: [], hasMore: false })

        const scheduler = createPollingScheduler({
          sourceId: 'test-source',
          handler,
          interval: 50,
        })

        await scheduler.start()
        await delay(100)
        await scheduler.stop()

        const health = scheduler.getHealth()
        expect(health.timeSinceLastSuccess).toBeDefined()
        expect(health.timeSinceLastSuccess).toBeLessThan(200)
      })
    })

    describe('metrics', () => {
      it('should track total polls', async () => {
        const handler = vi.fn().mockResolvedValue({ items: [], hasMore: false })

        const scheduler = createPollingScheduler({
          sourceId: 'test-source',
          handler,
          interval: 30,
        })

        await scheduler.start()
        await delay(150)
        await scheduler.stop()

        const metrics = scheduler.getMetrics()
        expect(metrics.totalPolls).toBeGreaterThanOrEqual(3)
      })

      it('should track successful polls', async () => {
        let failFirst = true
        const handler = vi.fn().mockImplementation(async () => {
          if (failFirst) {
            failFirst = false
            throw new Error('First fails')
          }
          return { items: [], hasMore: false }
        })

        const scheduler = createPollingScheduler({
          sourceId: 'test-source',
          handler,
          interval: 30,
          backoff: { initialDelayMs: 10 },
        })

        await scheduler.start()
        await delay(200)
        await scheduler.stop()

        const metrics = scheduler.getMetrics()
        expect(metrics.successfulPolls).toBeGreaterThan(0)
        expect(metrics.failedPolls).toBeGreaterThan(0)
      })

      it('should track items processed', async () => {
        let pollCount = 0
        const handler = vi.fn().mockImplementation(async () => {
          pollCount++
          return {
            items: [
              { id: `${pollCount}-1`, data: 'test', timestamp: Date.now() },
              { id: `${pollCount}-2`, data: 'test', timestamp: Date.now() },
            ],
            hasMore: false,
          }
        })

        const scheduler = createPollingScheduler({
          sourceId: 'test-source',
          handler,
          interval: 50,
          onItems: () => {},
        })

        await scheduler.start()
        await delay(150)
        await scheduler.stop()

        const metrics = scheduler.getMetrics()
        expect(metrics.itemsProcessed).toBeGreaterThanOrEqual(4)
      })

      it('should track poll latency', async () => {
        const handler = vi.fn().mockImplementation(async () => {
          await delay(20)
          return { items: [], hasMore: false }
        })

        const scheduler = createPollingScheduler({
          sourceId: 'test-source',
          handler,
          interval: 100,
        })

        await scheduler.start()
        await delay(150)
        await scheduler.stop()

        const metrics = scheduler.getMetrics()
        expect(metrics.avgPollLatencyMs).toBeGreaterThanOrEqual(15)
        expect(metrics.maxPollLatencyMs).toBeGreaterThanOrEqual(15)
      })

      it('should track empty poll ratio', async () => {
        let returnItems = true
        const handler = vi.fn().mockImplementation(async () => {
          const items = returnItems ? [{ id: '1', data: 'test', timestamp: Date.now() }] : []
          returnItems = !returnItems
          return { items, hasMore: false }
        })

        const scheduler = createPollingScheduler({
          sourceId: 'test-source',
          handler,
          interval: 30,
          onItems: () => {},
        })

        await scheduler.start()
        await delay(200)
        await scheduler.stop()

        const metrics = scheduler.getMetrics()
        expect(metrics.emptyPollRatio).toBeGreaterThan(0)
        expect(metrics.emptyPollRatio).toBeLessThan(1)
      })

      it('should reset metrics on demand', async () => {
        const handler = vi.fn().mockResolvedValue({ items: [], hasMore: false })

        const scheduler = createPollingScheduler({
          sourceId: 'test-source',
          handler,
          interval: 50,
        })

        await scheduler.start()
        await delay(100)

        scheduler.resetMetrics()
        const metrics = scheduler.getMetrics()
        expect(metrics.totalPolls).toBe(0)

        await scheduler.stop()
      })

      it('should provide histogram of poll latencies', async () => {
        const handler = vi.fn().mockImplementation(async () => {
          await delay(Math.random() * 50)
          return { items: [], hasMore: false }
        })

        const scheduler = createPollingScheduler({
          sourceId: 'test-source',
          handler,
          interval: 30,
        })

        await scheduler.start()
        await delay(300)
        await scheduler.stop()

        const metrics = scheduler.getMetrics()
        expect(metrics.latencyPercentiles).toBeDefined()
        expect(metrics.latencyPercentiles?.p50).toBeDefined()
        expect(metrics.latencyPercentiles?.p95).toBeDefined()
        expect(metrics.latencyPercentiles?.p99).toBeDefined()
      })
    })

    describe('observability', () => {
      it('should emit poll start event', async () => {
        const events: any[] = []
        const handler = vi.fn().mockResolvedValue({ items: [], hasMore: false })

        const scheduler = createPollingScheduler({
          sourceId: 'test-source',
          handler,
          interval: 100,
          onPollStart: (event) => {
            events.push(event)
          },
        })

        await scheduler.start()
        await delay(50)
        await scheduler.stop()

        expect(events.length).toBeGreaterThan(0)
        expect(events[0].sourceId).toBe('test-source')
        expect(events[0].timestamp).toBeDefined()
      })

      it('should emit poll complete event', async () => {
        const events: any[] = []
        const handler = vi.fn().mockResolvedValue({
          items: [{ id: '1', data: 'test', timestamp: Date.now() }],
          hasMore: false,
        })

        const scheduler = createPollingScheduler({
          sourceId: 'test-source',
          handler,
          interval: 100,
          onPollComplete: (event) => {
            events.push(event)
          },
        })

        await scheduler.start()
        await delay(50)
        await scheduler.stop()

        expect(events.length).toBeGreaterThan(0)
        expect(events[0].itemCount).toBe(1)
        expect(events[0].durationMs).toBeDefined()
      })

      it('should support custom metrics exporter', async () => {
        const exportedMetrics: PollMetrics[] = []
        const handler = vi.fn().mockResolvedValue({ items: [], hasMore: false })

        const scheduler = createPollingScheduler({
          sourceId: 'test-source',
          handler,
          interval: 50,
          metricsExporter: (metrics) => {
            exportedMetrics.push({ ...metrics })
          },
          metricsExportInterval: 100,
        })

        await scheduler.start()
        await delay(250)
        await scheduler.stop()

        expect(exportedMetrics.length).toBeGreaterThan(0)
      })
    })
  })

  // ============================================================================
  // LIFECYCLE
  // ============================================================================

  describe('lifecycle', () => {
    it('should start polling', async () => {
      const handler = vi.fn().mockResolvedValue({ items: [], hasMore: false })

      const scheduler = createPollingScheduler({
        sourceId: 'test-source',
        handler,
        interval: 100,
      })

      expect(scheduler.isRunning()).toBe(false)
      await scheduler.start()
      expect(scheduler.isRunning()).toBe(true)

      await scheduler.stop()
    })

    it('should stop polling', async () => {
      const handler = vi.fn().mockResolvedValue({ items: [], hasMore: false })

      const scheduler = createPollingScheduler({
        sourceId: 'test-source',
        handler,
        interval: 50,
      })

      await scheduler.start()
      await delay(100)
      await scheduler.stop()

      const callsAtStop = handler.mock.calls.length
      await delay(100)

      // No more calls after stop
      expect(handler.mock.calls.length).toBe(callsAtStop)
    })

    it('should pause and resume', async () => {
      const handler = vi.fn().mockResolvedValue({ items: [], hasMore: false })

      const scheduler = createPollingScheduler({
        sourceId: 'test-source',
        handler,
        interval: 30,
      })

      await scheduler.start()
      await delay(100)

      const callsBeforePause = handler.mock.calls.length
      scheduler.pause()
      await delay(100)

      expect(handler.mock.calls.length).toBe(callsBeforePause)

      scheduler.resume()
      await delay(100)

      expect(handler.mock.calls.length).toBeGreaterThan(callsBeforePause)

      await scheduler.stop()
    })

    it('should handle double start gracefully', async () => {
      const handler = vi.fn().mockResolvedValue({ items: [], hasMore: false })

      const scheduler = createPollingScheduler({
        sourceId: 'test-source',
        handler,
        interval: 100,
      })

      await scheduler.start()
      await expect(scheduler.start()).resolves.not.toThrow()

      await scheduler.stop()
    })

    it('should handle double stop gracefully', async () => {
      const handler = vi.fn().mockResolvedValue({ items: [], hasMore: false })

      const scheduler = createPollingScheduler({
        sourceId: 'test-source',
        handler,
        interval: 100,
      })

      await scheduler.start()
      await scheduler.stop()
      await expect(scheduler.stop()).resolves.not.toThrow()
    })

    it('should cleanup on dispose', async () => {
      const handler = vi.fn().mockResolvedValue({ items: [], hasMore: false })

      const scheduler = createPollingScheduler({
        sourceId: 'test-source',
        handler,
        interval: 50,
      })

      await scheduler.start()
      await scheduler.dispose()

      expect(scheduler.isRunning()).toBe(false)
      // Should not throw on operations after dispose
      await expect(scheduler.pollNow()).rejects.toThrow()
    })

    it('should wait for in-flight poll on stop', async () => {
      let pollCompleted = false
      const handler = vi.fn().mockImplementation(async () => {
        await delay(100)
        pollCompleted = true
        return { items: [], hasMore: false }
      })

      const scheduler = createPollingScheduler({
        sourceId: 'test-source',
        handler,
        interval: 200,
      })

      await scheduler.start()
      await delay(50) // Poll started but not finished

      await scheduler.stop() // Should wait for poll to complete
      expect(pollCompleted).toBe(true)
    })
  })

  // ============================================================================
  // FACTORY FUNCTION
  // ============================================================================

  describe('factory function', () => {
    it('should create a PollingScheduler instance', () => {
      const scheduler = createPollingScheduler({
        sourceId: 'test-source',
        handler: async () => ({ items: [], hasMore: false }),
        interval: 1000,
      })
      expect(scheduler).toBeInstanceOf(PollingScheduler)
    })

    it('should require sourceId', () => {
      expect(() =>
        createPollingScheduler({
          sourceId: '',
          handler: async () => ({ items: [], hasMore: false }),
          interval: 1000,
        })
      ).toThrow()
    })

    it('should require handler', () => {
      expect(() =>
        createPollingScheduler({
          sourceId: 'test-source',
          handler: undefined as any,
          interval: 1000,
        })
      ).toThrow()
    })

    it('should accept all options', () => {
      const scheduler = createPollingScheduler<TestItem>({
        sourceId: 'test-source',
        handler: async () => ({ items: [], hasMore: false }),
        interval: 1000,
        minInterval: 500,
        maxInterval: 5000,
        initialState: { cursor: 'start' },
        trackLastId: true,
        getItemId: (item) => item.id,
        deduplicate: true,
        dedupeWindowSize: 1000,
        dedupeTtlMs: 60000,
        getDedupeKey: (item) => item.id,
        rateLimit: {
          requestsPerSecond: 10,
          burstSize: 5,
        },
        backoff: {
          initialDelayMs: 1000,
          maxDelayMs: 60000,
          multiplier: 2,
          jitter: 0.1,
          maxRetries: 10,
        },
        healthThresholds: {
          degradedAfterErrors: 3,
          unhealthyAfterErrors: 10,
        },
        supportCancellation: true,
        onItems: () => {},
        onError: () => {},
        onRateLimited: () => {},
        onPollStart: () => {},
        onPollComplete: () => {},
        onGiveUp: () => {},
        metricsExporter: () => {},
        metricsExportInterval: 60000,
      })
      expect(scheduler).toBeDefined()
    })
  })
})
