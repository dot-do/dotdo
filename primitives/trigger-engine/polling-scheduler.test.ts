/**
 * PollingScheduler - Rate Limiting and State Tracking Tests
 *
 * RED phase: These tests define the expected behavior for advanced polling
 * scheduler features that are not yet implemented.
 *
 * Tests cover:
 * - Per-second and per-minute rate limiting
 * - Sliding window rate limiting
 * - State persistence (last poll time, cursor, pagination)
 * - Error tracking and intelligent backoff
 * - Circuit breaker pattern
 * - Jitter for distributed polling
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { PollingScheduler } from './index'

/**
 * Helper to create a mock fetch that returns fresh Response objects
 */
function createMockFetch(responses: Array<{ body: unknown, status?: number, headers?: Record<string, string> }>) {
  let callIndex = 0
  return vi.fn(() => {
    const config = responses[Math.min(callIndex++, responses.length - 1)]
    return Promise.resolve(new Response(
      JSON.stringify(config.body),
      { status: config.status || 200, headers: config.headers }
    ))
  })
}

function createErrorFetch(error: Error) {
  return vi.fn(() => Promise.reject(error))
}

describe('PollingScheduler - Rate Limiting', () => {
  let scheduler: PollingScheduler

  beforeEach(() => {
    scheduler = new PollingScheduler()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('requests per second limiting', () => {
    it('should limit requests to N per second', async () => {
      global.fetch = createMockFetch([{ body: [] }])

      scheduler.register('rate-limited-rps', {
        url: 'https://api.example.com',
        intervalMs: 100, // Want to poll every 100ms
        rateLimit: {
          requestsPerSecond: 2, // But limit to 2 per second
        },
      })

      // Try to poll 5 times within 1 second
      for (let i = 0; i < 5; i++) {
        await scheduler.poll('rate-limited-rps')
        vi.advanceTimersByTime(100)
      }

      // Should only have made 2 requests (rate limit)
      expect(global.fetch).toHaveBeenCalledTimes(2)
    })

    it('should allow more requests after rate limit window resets', async () => {
      global.fetch = createMockFetch([{ body: [] }])

      scheduler.register('rate-limited-rps', {
        url: 'https://api.example.com',
        intervalMs: 100,
        rateLimit: {
          requestsPerSecond: 2,
        },
      })

      // Exhaust the rate limit
      await scheduler.poll('rate-limited-rps')
      vi.advanceTimersByTime(100)
      await scheduler.poll('rate-limited-rps')
      vi.advanceTimersByTime(100)
      await scheduler.poll('rate-limited-rps') // Should be blocked

      // Advance past the 1 second window
      vi.advanceTimersByTime(1000)
      await scheduler.poll('rate-limited-rps') // Should succeed

      expect(global.fetch).toHaveBeenCalledTimes(3) // 2 in first window + 1 in second
    })

    it('should return rate limit info when request is blocked', async () => {
      global.fetch = createMockFetch([{ body: [] }])

      scheduler.register('rate-limited-rps', {
        url: 'https://api.example.com',
        intervalMs: 100,
        rateLimit: {
          requestsPerSecond: 1,
        },
      })

      await scheduler.poll('rate-limited-rps')
      vi.advanceTimersByTime(100)

      const rateLimitInfo = scheduler.getRateLimitInfo('rate-limited-rps')
      expect(rateLimitInfo).toMatchObject({
        isLimited: true,
        remainingRequests: 0,
        resetAt: expect.any(Number),
        retryAfterMs: expect.any(Number),
      })
    })
  })

  describe('requests per minute limiting', () => {
    it('should limit requests to N per minute', async () => {
      const mockFetch = vi.fn().mockResolvedValue(new Response('[]'))
      global.fetch = mockFetch

      scheduler.register('rate-limited-rpm', {
        url: 'https://api.example.com',
        intervalMs: 5_000, // Poll every 5 seconds
        rateLimit: {
          requestsPerMinute: 5, // But only 5 per minute
        },
      })

      // Try to poll 10 times within a minute
      for (let i = 0; i < 10; i++) {
        await scheduler.poll('rate-limited-rpm')
        vi.advanceTimersByTime(5_000)
      }

      // Should only have made 5 requests (rate limit)
      expect(mockFetch).toHaveBeenCalledTimes(5)
    })

    it('should track remaining quota', async () => {
      const mockFetch = vi.fn().mockResolvedValue(new Response('[]'))
      global.fetch = mockFetch

      scheduler.register('rate-limited-rpm', {
        url: 'https://api.example.com',
        intervalMs: 5_000,
        rateLimit: {
          requestsPerMinute: 10,
        },
      })

      await scheduler.poll('rate-limited-rpm')
      const info = scheduler.getRateLimitInfo('rate-limited-rpm')

      expect(info.remainingRequests).toBe(9)
    })
  })

  describe('sliding window rate limiting', () => {
    it('should use sliding window for smoother rate limiting', async () => {
      const mockFetch = vi.fn().mockResolvedValue(new Response('[]'))
      global.fetch = mockFetch

      scheduler.register('sliding-window', {
        url: 'https://api.example.com',
        intervalMs: 100,
        rateLimit: {
          requestsPerSecond: 4,
          algorithm: 'sliding-window', // Use sliding window instead of fixed window
        },
      })

      // Make 4 requests at end of first second
      vi.advanceTimersByTime(900)
      for (let i = 0; i < 4; i++) {
        await scheduler.poll('sliding-window')
        vi.advanceTimersByTime(25)
      }

      // At 200ms into next second, should NOT allow 4 more requests
      // because sliding window still counts requests from previous window
      vi.advanceTimersByTime(100)
      await scheduler.poll('sliding-window') // Should be blocked or limited

      // Sliding window should only allow ~2 requests here (4 * 0.2 overlap + new)
      expect(mockFetch).toHaveBeenCalledTimes(4) // No new requests allowed
    })
  })

  describe('token bucket rate limiting', () => {
    it('should support token bucket algorithm with burst capacity', async () => {
      const mockFetch = vi.fn().mockResolvedValue(new Response('[]'))
      global.fetch = mockFetch

      scheduler.register('token-bucket', {
        url: 'https://api.example.com',
        intervalMs: 100,
        rateLimit: {
          algorithm: 'token-bucket',
          tokensPerSecond: 2,
          bucketSize: 5, // Allow burst of up to 5
        },
      })

      // Should allow burst of 5 requests immediately
      for (let i = 0; i < 5; i++) {
        await scheduler.poll('token-bucket')
      }

      expect(mockFetch).toHaveBeenCalledTimes(5)

      // 6th request should be blocked (bucket empty)
      await scheduler.poll('token-bucket')
      expect(mockFetch).toHaveBeenCalledTimes(5)

      // After 0.5 seconds, should have 1 token refilled
      vi.advanceTimersByTime(500)
      await scheduler.poll('token-bucket')
      expect(mockFetch).toHaveBeenCalledTimes(6)
    })
  })

  describe('adaptive rate limiting', () => {
    it('should reduce rate when server returns 429', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce(new Response('[]', { status: 200 }))
        .mockResolvedValueOnce(new Response('Rate limited', { status: 429, headers: { 'Retry-After': '60' } }))
        .mockResolvedValueOnce(new Response('[]', { status: 200 }))
      global.fetch = mockFetch

      scheduler.register('adaptive', {
        url: 'https://api.example.com',
        intervalMs: 1000,
        rateLimit: {
          adaptive: true,
          respectRetryAfter: true,
        },
      })

      await scheduler.poll('adaptive')
      vi.advanceTimersByTime(1000)

      // This returns 429
      await expect(scheduler.poll('adaptive')).rejects.toThrow(/rate.*limit/i)

      // Should automatically back off for Retry-After duration
      vi.advanceTimersByTime(30_000) // Only 30 seconds
      const results = await scheduler.poll('adaptive')
      expect(results).toEqual([]) // Still blocked

      vi.advanceTimersByTime(30_000) // Now at 60 seconds
      const finalResults = await scheduler.poll('adaptive')
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })

    it('should parse Retry-After header as date', async () => {
      const retryDate = new Date(Date.now() + 30_000).toUTCString()
      const mockFetch = vi.fn()
        .mockResolvedValueOnce(new Response('Rate limited', {
          status: 429,
          headers: { 'Retry-After': retryDate }
        }))
      global.fetch = mockFetch

      scheduler.register('adaptive-date', {
        url: 'https://api.example.com',
        intervalMs: 1000,
        rateLimit: {
          adaptive: true,
          respectRetryAfter: true,
        },
      })

      await expect(scheduler.poll('adaptive-date')).rejects.toThrow()

      const info = scheduler.getRateLimitInfo('adaptive-date')
      expect(info.retryAfterMs).toBeGreaterThanOrEqual(29_000)
      expect(info.retryAfterMs).toBeLessThanOrEqual(31_000)
    })
  })
})

describe('PollingScheduler - State Tracking', () => {
  let scheduler: PollingScheduler

  beforeEach(() => {
    scheduler = new PollingScheduler()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('last poll time tracking', () => {
    it('should track last successful poll time', async () => {
      const mockFetch = vi.fn().mockResolvedValue(new Response('[]'))
      global.fetch = mockFetch

      scheduler.register('tracked', {
        url: 'https://api.example.com',
        intervalMs: 60_000,
      })

      const beforePoll = Date.now()
      await scheduler.poll('tracked')

      const state = await scheduler.getState('tracked')
      expect(state.lastPollTime).toBeGreaterThanOrEqual(beforePoll)
      expect(state.lastSuccessTime).toBeGreaterThanOrEqual(beforePoll)
    })

    it('should track last error time separately from last poll time', async () => {
      const mockFetch = vi.fn().mockRejectedValueOnce(new Error('API Error'))
      global.fetch = mockFetch

      scheduler.register('error-tracked', {
        url: 'https://api.example.com',
        intervalMs: 60_000,
      })

      await expect(scheduler.poll('error-tracked')).rejects.toThrow()

      const state = await scheduler.getState('error-tracked')
      expect(state.lastPollTime).toBeDefined()
      expect(state.lastErrorTime).toBeDefined()
      expect(state.lastSuccessTime).toBeUndefined()
    })

    it('should calculate time since last poll', async () => {
      const mockFetch = vi.fn().mockResolvedValue(new Response('[]'))
      global.fetch = mockFetch

      scheduler.register('time-since', {
        url: 'https://api.example.com',
        intervalMs: 60_000,
      })

      await scheduler.poll('time-since')
      vi.advanceTimersByTime(30_000) // 30 seconds later

      const state = await scheduler.getState('time-since')
      expect(state.timeSinceLastPoll).toBe(30_000)
    })
  })

  describe('cursor/pagination state', () => {
    it('should persist cursor between polls', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({
          items: [{ id: 1 }, { id: 2 }],
          nextCursor: 'cursor-abc',
        })))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          items: [{ id: 3 }, { id: 4 }],
          nextCursor: 'cursor-def',
        })))
      global.fetch = mockFetch

      scheduler.register('cursored', {
        url: 'https://api.example.com/items',
        intervalMs: 60_000,
        pagination: {
          cursorField: 'nextCursor',
          cursorParam: 'cursor',
        },
        transform: (data: unknown) => (data as { items: unknown[] }).items,
      })

      await scheduler.poll('cursored')

      const state = await scheduler.getState('cursored')
      expect(state.cursor).toBe('cursor-abc')

      // Second poll should use the cursor
      vi.advanceTimersByTime(60_000)
      await scheduler.poll('cursored')

      expect(mockFetch).toHaveBeenLastCalledWith(
        expect.stringContaining('cursor=cursor-abc'),
        expect.anything()
      )
    })

    it('should track page number for offset-based pagination', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify([{ id: 1 }, { id: 2 }]))
      )
      global.fetch = mockFetch

      scheduler.register('paged', {
        url: 'https://api.example.com/items',
        intervalMs: 60_000,
        pagination: {
          type: 'offset',
          pageSize: 10,
          pageParam: 'page',
        },
      })

      await scheduler.poll('paged')
      const state1 = await scheduler.getState('paged')
      expect(state1.page).toBe(0)

      // Advance page
      await scheduler.advancePage('paged')
      const state2 = await scheduler.getState('paged')
      expect(state2.page).toBe(1)
    })

    it('should track since_id for ID-based pagination', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify([
          { id: 100, text: 'tweet 1' },
          { id: 101, text: 'tweet 2' },
        ])))
        .mockResolvedValueOnce(new Response(JSON.stringify([
          { id: 102, text: 'tweet 3' },
        ])))
      global.fetch = mockFetch

      scheduler.register('since-id', {
        url: 'https://api.example.com/tweets',
        intervalMs: 60_000,
        idField: 'id',
        pagination: {
          type: 'since-id',
          sinceIdParam: 'since_id',
        },
      })

      await scheduler.poll('since-id')

      const state = await scheduler.getState('since-id')
      expect(state.sinceId).toBe(101) // Max ID from first batch

      // Next poll should include since_id
      vi.advanceTimersByTime(60_000)
      await scheduler.poll('since-id')

      expect(mockFetch).toHaveBeenLastCalledWith(
        expect.stringContaining('since_id=101'),
        expect.anything()
      )
    })

    it('should reset cursor on demand', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ items: [], nextCursor: 'cursor-xyz' }))
      )
      global.fetch = mockFetch

      scheduler.register('resettable', {
        url: 'https://api.example.com/items',
        intervalMs: 60_000,
        pagination: {
          cursorField: 'nextCursor',
          cursorParam: 'cursor',
        },
      })

      await scheduler.poll('resettable')
      await scheduler.resetState('resettable')

      const state = await scheduler.getState('resettable')
      expect(state.cursor).toBeUndefined()
      expect(state.page).toBeUndefined()
      expect(state.sinceId).toBeUndefined()
    })
  })

  describe('poll history tracking', () => {
    it('should maintain history of recent polls', async () => {
      const mockFetch = vi.fn().mockResolvedValue(new Response('[]'))
      global.fetch = mockFetch

      scheduler.register('with-history', {
        url: 'https://api.example.com',
        intervalMs: 60_000,
        tracking: {
          historySize: 5,
        },
      })

      for (let i = 0; i < 3; i++) {
        await scheduler.poll('with-history')
        vi.advanceTimersByTime(60_000)
      }

      const history = await scheduler.getHistory('with-history')
      expect(history).toHaveLength(3)
      expect(history[0]).toMatchObject({
        timestamp: expect.any(Number),
        success: true,
        itemCount: 0,
      })
    })

    it('should limit history to configured size', async () => {
      const mockFetch = vi.fn().mockResolvedValue(new Response('[]'))
      global.fetch = mockFetch

      scheduler.register('limited-history', {
        url: 'https://api.example.com',
        intervalMs: 1000,
        tracking: {
          historySize: 3,
        },
      })

      for (let i = 0; i < 10; i++) {
        await scheduler.poll('limited-history')
        vi.advanceTimersByTime(1000)
      }

      const history = await scheduler.getHistory('limited-history')
      expect(history).toHaveLength(3)
    })

    it('should track items returned per poll in history', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 1 }, { id: 2 }])))
        .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 3 }])))
        .mockResolvedValueOnce(new Response(JSON.stringify([])))
      global.fetch = mockFetch

      scheduler.register('item-history', {
        url: 'https://api.example.com/items',
        intervalMs: 60_000,
        idField: 'id',
        tracking: {
          historySize: 10,
        },
      })

      await scheduler.poll('item-history')
      vi.advanceTimersByTime(60_000)
      await scheduler.poll('item-history')
      vi.advanceTimersByTime(60_000)
      await scheduler.poll('item-history')

      const history = await scheduler.getHistory('item-history')
      expect(history[0].itemCount).toBe(2)
      expect(history[1].itemCount).toBe(1)
      expect(history[2].itemCount).toBe(0)
    })
  })

  describe('state persistence', () => {
    it('should support external state storage', async () => {
      const mockFetch = vi.fn().mockResolvedValue(new Response('[]'))
      global.fetch = mockFetch

      const stateStore = new Map<string, unknown>()

      scheduler.register('persistent', {
        url: 'https://api.example.com',
        intervalMs: 60_000,
        stateStorage: {
          get: async (key) => stateStore.get(key),
          set: async (key, value) => { stateStore.set(key, value) },
        },
      })

      await scheduler.poll('persistent')

      // State should be persisted to external store
      expect(stateStore.has('persistent')).toBe(true)
      const storedState = stateStore.get('persistent') as { lastPollTime: number }
      expect(storedState.lastPollTime).toBeDefined()
    })

    it('should restore state from external storage on startup', async () => {
      const mockFetch = vi.fn().mockResolvedValue(new Response('[]'))
      global.fetch = mockFetch

      const savedState = {
        cursor: 'saved-cursor-xyz',
        lastPollTime: Date.now() - 30_000,
      }
      const stateStore = new Map<string, unknown>([['restored', savedState]])

      scheduler.register('restored', {
        url: 'https://api.example.com',
        intervalMs: 60_000,
        pagination: {
          cursorParam: 'cursor',
        },
        stateStorage: {
          get: async (key) => stateStore.get(key),
          set: async (key, value) => { stateStore.set(key, value) },
        },
      })

      await scheduler.poll('restored')

      // Should use restored cursor
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('cursor=saved-cursor-xyz'),
        expect.anything()
      )
    })
  })
})

describe('PollingScheduler - Backoff on Errors', () => {
  let scheduler: PollingScheduler

  beforeEach(() => {
    scheduler = new PollingScheduler()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('exponential backoff', () => {
    it('should apply configurable base and max backoff', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('API Error'))
      global.fetch = mockFetch

      scheduler.register('custom-backoff', {
        url: 'https://api.example.com',
        intervalMs: 60_000,
        backoff: {
          initialMs: 500,
          maxMs: 16_000,
          multiplier: 2,
        },
      })

      // First failure: 500ms backoff
      await expect(scheduler.poll('custom-backoff')).rejects.toThrow()
      expect(scheduler.getBackoffMs('custom-backoff')).toBe(500)

      // Second failure: 1000ms backoff
      vi.advanceTimersByTime(500)
      await expect(scheduler.poll('custom-backoff')).rejects.toThrow()
      expect(scheduler.getBackoffMs('custom-backoff')).toBe(1000)

      // Third failure: 2000ms backoff
      vi.advanceTimersByTime(1000)
      await expect(scheduler.poll('custom-backoff')).rejects.toThrow()
      expect(scheduler.getBackoffMs('custom-backoff')).toBe(2000)

      // Continue until max
      vi.advanceTimersByTime(2000)
      await expect(scheduler.poll('custom-backoff')).rejects.toThrow() // 4000
      vi.advanceTimersByTime(4000)
      await expect(scheduler.poll('custom-backoff')).rejects.toThrow() // 8000
      vi.advanceTimersByTime(8000)
      await expect(scheduler.poll('custom-backoff')).rejects.toThrow() // 16000 (max)
      vi.advanceTimersByTime(16000)
      await expect(scheduler.poll('custom-backoff')).rejects.toThrow() // Still 16000 (capped)

      expect(scheduler.getBackoffMs('custom-backoff')).toBe(16_000)
    })

    it('should support custom multiplier', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('API Error'))
      global.fetch = mockFetch

      scheduler.register('triple-backoff', {
        url: 'https://api.example.com',
        intervalMs: 60_000,
        backoff: {
          initialMs: 1000,
          maxMs: 100_000,
          multiplier: 3,
        },
      })

      await expect(scheduler.poll('triple-backoff')).rejects.toThrow() // 1000
      vi.advanceTimersByTime(1000)
      await expect(scheduler.poll('triple-backoff')).rejects.toThrow() // 3000
      vi.advanceTimersByTime(3000)
      await expect(scheduler.poll('triple-backoff')).rejects.toThrow() // 9000

      expect(scheduler.getBackoffMs('triple-backoff')).toBe(9000)
    })
  })

  describe('jitter', () => {
    it('should add random jitter to backoff', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('API Error'))
      global.fetch = mockFetch

      scheduler.register('jittered', {
        url: 'https://api.example.com',
        intervalMs: 60_000,
        backoff: {
          initialMs: 1000,
          maxMs: 60_000,
          multiplier: 2,
          jitter: 0.5, // +/- 50% jitter
        },
      })

      await expect(scheduler.poll('jittered')).rejects.toThrow()

      const backoff = scheduler.getBackoffMs('jittered')
      // With 50% jitter on 1000ms, should be between 500 and 1500
      expect(backoff).toBeGreaterThanOrEqual(500)
      expect(backoff).toBeLessThanOrEqual(1500)
    })

    it('should apply different jitter values for distributed polling', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('API Error'))
      global.fetch = mockFetch

      const backoffs: number[] = []

      // Simulate multiple scheduler instances (distributed)
      for (let i = 0; i < 10; i++) {
        const sched = new PollingScheduler()
        sched.register('distributed', {
          url: 'https://api.example.com',
          intervalMs: 60_000,
          backoff: {
            initialMs: 1000,
            maxMs: 60_000,
            jitter: 0.5,
          },
        })

        await expect(sched.poll('distributed')).rejects.toThrow()
        backoffs.push(sched.getBackoffMs('distributed'))
      }

      // Not all backoffs should be identical (jitter should vary)
      const uniqueBackoffs = new Set(backoffs)
      expect(uniqueBackoffs.size).toBeGreaterThan(1)
    })
  })

  describe('circuit breaker', () => {
    it('should open circuit after consecutive failures', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('API Error'))
      global.fetch = mockFetch

      scheduler.register('circuit-breaker', {
        url: 'https://api.example.com',
        intervalMs: 1000,
        circuitBreaker: {
          failureThreshold: 3,
          resetTimeoutMs: 30_000,
        },
      })

      // Trigger 3 failures
      for (let i = 0; i < 3; i++) {
        await expect(scheduler.poll('circuit-breaker')).rejects.toThrow()
        vi.advanceTimersByTime(1000)
      }

      // Circuit should be open
      const state = await scheduler.getState('circuit-breaker')
      expect(state.circuitState).toBe('open')

      // Subsequent polls should be rejected immediately without making HTTP request
      mockFetch.mockClear()
      await expect(scheduler.poll('circuit-breaker')).rejects.toThrow(/circuit.*open/i)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should half-open circuit after reset timeout', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('API Error'))
      global.fetch = mockFetch

      scheduler.register('half-open', {
        url: 'https://api.example.com',
        intervalMs: 1000,
        circuitBreaker: {
          failureThreshold: 2,
          resetTimeoutMs: 10_000,
        },
      })

      // Open the circuit
      await expect(scheduler.poll('half-open')).rejects.toThrow()
      vi.advanceTimersByTime(1000)
      await expect(scheduler.poll('half-open')).rejects.toThrow()

      // Verify circuit is open
      let state = await scheduler.getState('half-open')
      expect(state.circuitState).toBe('open')

      // After reset timeout, circuit should be half-open
      vi.advanceTimersByTime(10_000)
      state = await scheduler.getState('half-open')
      expect(state.circuitState).toBe('half-open')
    })

    it('should close circuit after successful request in half-open state', async () => {
      const mockFetch = vi.fn()
        .mockRejectedValueOnce(new Error('API Error'))
        .mockRejectedValueOnce(new Error('API Error'))
        .mockResolvedValueOnce(new Response('[]'))
      global.fetch = mockFetch

      scheduler.register('recovering', {
        url: 'https://api.example.com',
        intervalMs: 1000,
        circuitBreaker: {
          failureThreshold: 2,
          resetTimeoutMs: 5_000,
        },
      })

      // Open the circuit
      await expect(scheduler.poll('recovering')).rejects.toThrow()
      vi.advanceTimersByTime(1000)
      await expect(scheduler.poll('recovering')).rejects.toThrow()

      // Wait for half-open
      vi.advanceTimersByTime(5_000)

      // Success should close circuit
      await scheduler.poll('recovering')

      const state = await scheduler.getState('recovering')
      expect(state.circuitState).toBe('closed')
    })

    it('should re-open circuit if half-open request fails', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('API Error'))
      global.fetch = mockFetch

      scheduler.register('still-failing', {
        url: 'https://api.example.com',
        intervalMs: 1000,
        circuitBreaker: {
          failureThreshold: 2,
          resetTimeoutMs: 5_000,
        },
      })

      // Open the circuit
      await expect(scheduler.poll('still-failing')).rejects.toThrow()
      vi.advanceTimersByTime(1000)
      await expect(scheduler.poll('still-failing')).rejects.toThrow()

      // Wait for half-open and try again
      vi.advanceTimersByTime(5_000)
      await expect(scheduler.poll('still-failing')).rejects.toThrow()

      const state = await scheduler.getState('still-failing')
      expect(state.circuitState).toBe('open')
    })
  })

  describe('error categorization', () => {
    it('should differentiate between transient and permanent errors', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce(new Response('Not Found', { status: 404 }))
        .mockResolvedValueOnce(new Response('Server Error', { status: 503 }))
      global.fetch = mockFetch

      scheduler.register('categorized', {
        url: 'https://api.example.com',
        intervalMs: 60_000,
        errorHandling: {
          transientStatuses: [500, 502, 503, 504],
          permanentStatuses: [400, 401, 403, 404],
        },
      })

      // 404 should be permanent - no backoff
      await expect(scheduler.poll('categorized')).rejects.toThrow()
      expect(scheduler.getBackoffMs('categorized')).toBe(0)

      // 503 should be transient - apply backoff
      await expect(scheduler.poll('categorized')).rejects.toThrow()
      expect(scheduler.getBackoffMs('categorized')).toBeGreaterThan(0)
    })

    it('should not count permanent errors towards circuit breaker threshold', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValue(new Response('Not Found', { status: 404 }))
      global.fetch = mockFetch

      scheduler.register('permanent-errors', {
        url: 'https://api.example.com',
        intervalMs: 1000,
        errorHandling: {
          permanentStatuses: [404],
        },
        circuitBreaker: {
          failureThreshold: 2,
          resetTimeoutMs: 10_000,
        },
      })

      // Multiple 404s should not trip circuit breaker
      for (let i = 0; i < 5; i++) {
        await expect(scheduler.poll('permanent-errors')).rejects.toThrow()
        vi.advanceTimersByTime(1000)
      }

      const state = await scheduler.getState('permanent-errors')
      expect(state.circuitState).toBe('closed')
    })
  })

  describe('error tracking and metrics', () => {
    it('should track consecutive error count', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('API Error'))
      global.fetch = mockFetch

      scheduler.register('error-counted', {
        url: 'https://api.example.com',
        intervalMs: 1000,
      })

      for (let i = 0; i < 5; i++) {
        await expect(scheduler.poll('error-counted')).rejects.toThrow()
        vi.advanceTimersByTime(10_000) // Wait for backoff
      }

      const state = await scheduler.getState('error-counted')
      expect(state.consecutiveErrors).toBe(5)
    })

    it('should reset consecutive error count on success', async () => {
      const mockFetch = vi.fn()
        .mockRejectedValueOnce(new Error('API Error'))
        .mockRejectedValueOnce(new Error('API Error'))
        .mockResolvedValueOnce(new Response('[]'))
      global.fetch = mockFetch

      scheduler.register('error-reset', {
        url: 'https://api.example.com',
        intervalMs: 1000,
      })

      await expect(scheduler.poll('error-reset')).rejects.toThrow()
      vi.advanceTimersByTime(1000)
      await expect(scheduler.poll('error-reset')).rejects.toThrow()
      vi.advanceTimersByTime(2000)
      await scheduler.poll('error-reset')

      const state = await scheduler.getState('error-reset')
      expect(state.consecutiveErrors).toBe(0)
    })

    it('should track total error count', async () => {
      const mockFetch = vi.fn()
        .mockRejectedValueOnce(new Error('Error 1'))
        .mockResolvedValueOnce(new Response('[]'))
        .mockRejectedValueOnce(new Error('Error 2'))
        .mockResolvedValueOnce(new Response('[]'))
      global.fetch = mockFetch

      scheduler.register('total-errors', {
        url: 'https://api.example.com',
        intervalMs: 1000,
      })

      await expect(scheduler.poll('total-errors')).rejects.toThrow()
      vi.advanceTimersByTime(1000)
      await scheduler.poll('total-errors')
      vi.advanceTimersByTime(1000)
      await expect(scheduler.poll('total-errors')).rejects.toThrow()
      vi.advanceTimersByTime(1000)
      await scheduler.poll('total-errors')

      const state = await scheduler.getState('total-errors')
      expect(state.totalErrors).toBe(2)
      expect(state.consecutiveErrors).toBe(0)
    })
  })
})
