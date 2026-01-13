/**
 * Polling Scheduler Tests - Rate Limiting, State Tracking
 *
 * RED TDD Phase: These tests define the contract for the polling scheduler.
 * All tests should FAIL until implementation is complete.
 *
 * Test Coverage:
 * 1. Cron-based polling schedule
 * 2. Interval-based polling
 * 3. Rate limiting per source
 * 4. Cursor/checkpoint state tracking
 * 5. Deduplication of already-seen items
 * 6. Backoff on errors
 * 7. Concurrent poll prevention
 * 8. Polling history/audit log
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ============================================================================
// EXPECTED TYPES (Design Contract)
// ============================================================================

/**
 * Configuration for cron-based polling
 */
interface CronScheduleConfig {
  /** Cron expression (e.g., "0 * * * *" for hourly) */
  cron: string
  /** Timezone for cron evaluation */
  timezone?: string
  /** Maximum jitter in milliseconds to prevent thundering herd */
  jitterMs?: number
}

/**
 * Configuration for interval-based polling
 */
interface IntervalScheduleConfig {
  /** Fixed interval in milliseconds */
  intervalMs: number
  /** Optional dynamic interval function based on results */
  dynamicInterval?: (lastResult: PollResult) => number
  /** Minimum interval (for dynamic) */
  minIntervalMs?: number
  /** Maximum interval (for dynamic) */
  maxIntervalMs?: number
}

/**
 * Rate limiting configuration per source
 */
interface RateLimitConfig {
  /** Maximum requests per second */
  requestsPerSecond?: number
  /** Maximum requests per minute */
  requestsPerMinute?: number
  /** Maximum requests per hour */
  requestsPerHour?: number
  /** Token bucket burst size */
  burstSize?: number
  /** Rate limit algorithm: 'token-bucket' | 'sliding-window' | 'fixed-window' */
  algorithm?: 'token-bucket' | 'sliding-window' | 'fixed-window'
}

/**
 * Checkpoint/cursor state for resumable polling
 */
interface CheckpointState {
  /** Cursor for pagination (API-provided) */
  cursor?: string
  /** Last seen item ID for since_id pagination */
  lastSeenId?: string
  /** Last item timestamp for timestamp-based pagination */
  lastItemTimestamp?: number
  /** Page number for offset-based pagination */
  pageNumber?: number
  /** Custom state fields from poll results */
  customState?: Record<string, unknown>
  /** Timestamp of last successful poll */
  lastSuccessAt?: number
  /** Timestamp of last poll attempt (success or failure) */
  lastPollAt?: number
}

/**
 * Deduplication configuration
 */
interface DeduplicationConfig {
  /** Enable deduplication */
  enabled: boolean
  /** How to extract unique key from items */
  keyExtractor: (item: unknown) => string
  /** TTL for dedup cache entries in milliseconds */
  ttlMs?: number
  /** Maximum entries in dedup cache */
  maxEntries?: number
  /** Storage backend: 'memory' | 'durable-object' */
  storage?: 'memory' | 'durable-object'
}

/**
 * Backoff configuration for error handling
 */
interface BackoffConfig {
  /** Initial delay after first failure (ms) */
  initialDelayMs: number
  /** Maximum delay cap (ms) */
  maxDelayMs: number
  /** Multiplier for exponential backoff */
  multiplier: number
  /** Jitter factor (0-1) for randomization */
  jitter?: number
  /** Maximum retries before circuit opens */
  maxRetries?: number
}

/**
 * Poll result from a single poll operation
 */
interface PollResult<T = unknown> {
  /** Items retrieved in this poll */
  items: T[]
  /** Whether there are more items to fetch */
  hasMore: boolean
  /** Next cursor for pagination */
  nextCursor?: string
  /** Custom state to persist */
  customState?: Record<string, unknown>
}

/**
 * Audit log entry for a poll operation
 */
interface PollAuditEntry {
  /** Unique ID for this poll operation */
  pollId: string
  /** Source identifier */
  sourceId: string
  /** Timestamp when poll started */
  startedAt: number
  /** Timestamp when poll completed */
  completedAt: number
  /** Duration in milliseconds */
  durationMs: number
  /** Number of items retrieved */
  itemCount: number
  /** Whether poll succeeded */
  success: boolean
  /** Error message if failed */
  error?: string
  /** Checkpoint state after poll */
  checkpointState: CheckpointState
  /** Rate limit state at time of poll */
  rateLimitState?: {
    remainingRequests: number
    resetAt: number
  }
}

/**
 * Full polling scheduler configuration
 */
interface PollingSchedulerConfig<T = unknown> {
  /** Unique identifier for this poll source */
  sourceId: string
  /** The poll handler function */
  handler: (state: CheckpointState) => Promise<PollResult<T>>
  /** Schedule configuration (cron or interval) */
  schedule: CronScheduleConfig | IntervalScheduleConfig
  /** Rate limiting configuration */
  rateLimit?: RateLimitConfig
  /** Checkpoint/state persistence */
  checkpoint?: {
    /** Storage backend for checkpoints */
    storage: 'memory' | 'durable-object' | 'kv'
    /** Key prefix for storage */
    keyPrefix?: string
  }
  /** Deduplication configuration */
  deduplication?: DeduplicationConfig
  /** Backoff configuration for errors */
  backoff?: BackoffConfig
  /** Callback when items are retrieved */
  onItems?: (items: T[]) => void | Promise<void>
  /** Callback on poll errors */
  onError?: (error: Error, state: CheckpointState) => void
  /** Audit logging configuration */
  auditLog?: {
    enabled: boolean
    maxEntries?: number
    storage?: 'memory' | 'durable-object'
  }
}

// ============================================================================
// TEST SETUP
// ============================================================================

// Note: These imports will fail until implementation exists
// This is intentional for RED TDD phase
const importModule = async () => {
  return import('../polling-scheduler')
}

describe('Polling Scheduler - lib/triggers', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  // ==========================================================================
  // 1. CRON-BASED POLLING SCHEDULE
  // ==========================================================================

  describe('1. Cron-based polling schedule', () => {
    it('should export createCronScheduler function', async () => {
      // RED: This test should fail because the module doesn't exist
      const module = await importModule()
      expect(module.createCronScheduler).toBeDefined()
      expect(typeof module.createCronScheduler).toBe('function')
    })

    it('should parse standard cron expressions', async () => {
      // RED: Test cron expression parsing
      const module = await importModule()
      const scheduler = module.createCronScheduler({
        sourceId: 'test-cron',
        cron: '0 * * * *', // Every hour at minute 0
        handler: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
      })

      expect(scheduler).toBeDefined()
      expect(scheduler.getNextRunTime()).toBeDefined()
    })

    it('should support 5-field cron (minute hour day month weekday)', async () => {
      const module = await importModule()
      const handler = vi.fn().mockResolvedValue({ items: [], hasMore: false })

      const scheduler = module.createCronScheduler({
        sourceId: 'test-5-field',
        cron: '30 9 * * 1-5', // 9:30 AM weekdays
        handler,
      })

      const nextRun = scheduler.getNextRunTime()
      const nextDate = new Date(nextRun)

      // Should be at 9:30
      expect(nextDate.getHours()).toBe(9)
      expect(nextDate.getMinutes()).toBe(30)
      // Should be a weekday (1-5)
      expect(nextDate.getDay()).toBeGreaterThanOrEqual(1)
      expect(nextDate.getDay()).toBeLessThanOrEqual(5)
    })

    it('should support 6-field cron with seconds', async () => {
      const module = await importModule()
      const handler = vi.fn().mockResolvedValue({ items: [], hasMore: false })

      const scheduler = module.createCronScheduler({
        sourceId: 'test-6-field',
        cron: '0 30 9 * * 1-5', // 9:30:00 AM weekdays (with seconds)
        handler,
        cronFormat: '6-field',
      })

      expect(scheduler.getNextRunTime()).toBeDefined()
    })

    it('should respect timezone configuration', async () => {
      const module = await importModule()
      const handler = vi.fn().mockResolvedValue({ items: [], hasMore: false })

      const schedulerUTC = module.createCronScheduler({
        sourceId: 'test-utc',
        cron: '0 9 * * *', // 9 AM
        timezone: 'UTC',
        handler,
      })

      const schedulerPST = module.createCronScheduler({
        sourceId: 'test-pst',
        cron: '0 9 * * *', // 9 AM
        timezone: 'America/Los_Angeles',
        handler,
      })

      const utcNext = schedulerUTC.getNextRunTime()
      const pstNext = schedulerPST.getNextRunTime()

      // PST is 8 hours behind UTC, so next runs should differ
      expect(Math.abs(utcNext - pstNext)).toBeGreaterThan(0)
    })

    it('should apply jitter to prevent thundering herd', async () => {
      const module = await importModule()
      const handler = vi.fn().mockResolvedValue({ items: [], hasMore: false })

      const nextRuns: number[] = []

      // Create multiple schedulers with same cron but jitter
      for (let i = 0; i < 10; i++) {
        const scheduler = module.createCronScheduler({
          sourceId: `test-jitter-${i}`,
          cron: '0 * * * *',
          jitterMs: 30000, // 30 second jitter
          handler,
        })
        nextRuns.push(scheduler.getNextRunTime())
      }

      // With jitter, not all next runs should be identical
      const uniqueRuns = new Set(nextRuns)
      expect(uniqueRuns.size).toBeGreaterThan(1)
    })

    it('should execute handler at scheduled times', async () => {
      const module = await importModule()
      const handler = vi.fn().mockResolvedValue({ items: [], hasMore: false })

      // Set fake time to just before the next scheduled run
      vi.setSystemTime(new Date('2024-01-15T08:59:00Z'))

      const scheduler = module.createCronScheduler({
        sourceId: 'test-execute',
        cron: '0 9 * * *', // 9 AM daily
        timezone: 'UTC',
        handler,
      })

      await scheduler.start()

      // Advance time past 9 AM
      vi.advanceTimersByTime(2 * 60 * 1000) // 2 minutes

      expect(handler).toHaveBeenCalledTimes(1)

      await scheduler.stop()
    })

    it('should calculate next run after execution', async () => {
      const module = await importModule()
      const handler = vi.fn().mockResolvedValue({ items: [], hasMore: false })

      vi.setSystemTime(new Date('2024-01-15T09:00:00Z'))

      const scheduler = module.createCronScheduler({
        sourceId: 'test-next',
        cron: '0 * * * *', // Every hour
        timezone: 'UTC',
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(1000) // Trigger first run

      const nextRun = scheduler.getNextRunTime()
      const nextDate = new Date(nextRun)

      // Should be scheduled for 10:00
      expect(nextDate.getHours()).toBe(10)
      expect(nextDate.getMinutes()).toBe(0)

      await scheduler.stop()
    })

    it('should throw on invalid cron expression', async () => {
      const module = await importModule()
      const handler = vi.fn()

      expect(() =>
        module.createCronScheduler({
          sourceId: 'test-invalid',
          cron: 'invalid cron',
          handler,
        })
      ).toThrow(/invalid.*cron/i)
    })

    it('should handle DST transitions correctly', async () => {
      const module = await importModule()
      const handler = vi.fn().mockResolvedValue({ items: [], hasMore: false })

      // Day before DST spring forward in US
      vi.setSystemTime(new Date('2024-03-09T01:00:00-08:00'))

      const scheduler = module.createCronScheduler({
        sourceId: 'test-dst',
        cron: '30 2 * * *', // 2:30 AM (doesn't exist during spring forward)
        timezone: 'America/Los_Angeles',
        handler,
      })

      // Should handle the non-existent time gracefully
      const nextRun = scheduler.getNextRunTime()
      expect(nextRun).toBeGreaterThan(Date.now())
    })
  })

  // ==========================================================================
  // 2. INTERVAL-BASED POLLING
  // ==========================================================================

  describe('2. Interval-based polling', () => {
    it('should export createIntervalScheduler function', async () => {
      const module = await importModule()
      expect(module.createIntervalScheduler).toBeDefined()
      expect(typeof module.createIntervalScheduler).toBe('function')
    })

    it('should poll at fixed intervals', async () => {
      const module = await importModule()
      const handler = vi.fn().mockResolvedValue({ items: [], hasMore: false })

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-fixed',
        intervalMs: 5000, // 5 seconds
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(17000) // 17 seconds
      await scheduler.stop()

      // Should have polled ~3-4 times (0s, 5s, 10s, 15s)
      expect(handler.mock.calls.length).toBeGreaterThanOrEqual(3)
      expect(handler.mock.calls.length).toBeLessThanOrEqual(4)
    })

    it('should support dynamic intervals based on results', async () => {
      const module = await importModule()
      let pollCount = 0
      const handler = vi.fn().mockImplementation(async () => {
        pollCount++
        return {
          items: pollCount < 3 ? [{ id: pollCount }] : [],
          hasMore: pollCount < 3,
        }
      })

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-dynamic',
        intervalMs: 1000,
        dynamicInterval: (result: PollResult) => (result.hasMore ? 500 : 5000),
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(10000)
      await scheduler.stop()

      // First few polls should be fast (500ms), then slow down (5000ms)
      expect(handler.mock.calls.length).toBeGreaterThanOrEqual(4)
    })

    it('should respect minimum interval bounds', async () => {
      const module = await importModule()
      const handler = vi.fn().mockResolvedValue({ items: [], hasMore: true })

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-min-bound',
        intervalMs: 1000,
        dynamicInterval: () => 10, // Try to go very fast
        minIntervalMs: 500, // But minimum is 500ms
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(2000)
      await scheduler.stop()

      // With 500ms min interval, should have at most 4-5 calls in 2 seconds
      expect(handler.mock.calls.length).toBeLessThanOrEqual(5)
    })

    it('should respect maximum interval bounds', async () => {
      const module = await importModule()
      const handler = vi.fn().mockResolvedValue({ items: [], hasMore: false })

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-max-bound',
        intervalMs: 1000,
        dynamicInterval: () => 60000, // Try to go very slow
        maxIntervalMs: 2000, // But maximum is 2 seconds
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(5000)
      await scheduler.stop()

      // With 2s max interval, should have at least 2-3 calls in 5 seconds
      expect(handler.mock.calls.length).toBeGreaterThanOrEqual(2)
    })

    it('should start immediately by default', async () => {
      const module = await importModule()
      const handler = vi.fn().mockResolvedValue({ items: [], hasMore: false })

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-immediate',
        intervalMs: 60000, // 1 minute
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(100) // Just 100ms

      expect(handler).toHaveBeenCalledTimes(1)

      await scheduler.stop()
    })

    it('should support delayed start', async () => {
      const module = await importModule()
      const handler = vi.fn().mockResolvedValue({ items: [], hasMore: false })

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-delayed',
        intervalMs: 1000,
        startImmediately: false,
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(500) // Half interval

      expect(handler).not.toHaveBeenCalled()

      vi.advanceTimersByTime(600) // Past first interval

      expect(handler).toHaveBeenCalledTimes(1)

      await scheduler.stop()
    })

    it('should not drift over long periods', async () => {
      const module = await importModule()
      const callTimes: number[] = []
      const handler = vi.fn().mockImplementation(async () => {
        callTimes.push(Date.now())
        await new Promise((r) => setTimeout(r, 50)) // Simulate 50ms work
        return { items: [], hasMore: false }
      })

      vi.setSystemTime(0)

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-drift',
        intervalMs: 1000,
        handler,
      })

      await scheduler.start()

      // Run for 10 intervals
      for (let i = 0; i < 10; i++) {
        vi.advanceTimersByTime(1000)
        await vi.runAllTimersAsync()
      }

      await scheduler.stop()

      // Check that intervals don't accumulate drift
      if (callTimes.length >= 5) {
        const lastFiveIntervals = []
        for (let i = callTimes.length - 5; i < callTimes.length - 1; i++) {
          lastFiveIntervals.push(callTimes[i + 1]! - callTimes[i]!)
        }
        const avgInterval = lastFiveIntervals.reduce((a, b) => a + b, 0) / lastFiveIntervals.length
        // Average should still be close to 1000ms despite 50ms handler time
        expect(avgInterval).toBeGreaterThanOrEqual(950)
        expect(avgInterval).toBeLessThanOrEqual(1100)
      }
    })

    it('should parse interval from string format', async () => {
      const module = await importModule()
      const handler = vi.fn().mockResolvedValue({ items: [], hasMore: false })

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-string-interval',
        interval: '30s', // String format
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(65000) // 65 seconds
      await scheduler.stop()

      // Should have polled ~2-3 times
      expect(handler.mock.calls.length).toBeGreaterThanOrEqual(2)
      expect(handler.mock.calls.length).toBeLessThanOrEqual(3)
    })
  })

  // ==========================================================================
  // 3. RATE LIMITING PER SOURCE
  // ==========================================================================

  describe('3. Rate limiting per source', () => {
    it('should export RateLimiter class', async () => {
      const module = await importModule()
      expect(module.RateLimiter).toBeDefined()
    })

    it('should limit requests per second', async () => {
      const module = await importModule()
      const handler = vi.fn().mockResolvedValue({ items: [], hasMore: true })

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-rps',
        intervalMs: 10, // Try to poll every 10ms (100 RPS)
        rateLimit: {
          requestsPerSecond: 5, // But limit to 5 RPS
        },
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(1000) // 1 second
      await scheduler.stop()

      // Should have at most 5-6 calls (5 RPS + initial)
      expect(handler.mock.calls.length).toBeLessThanOrEqual(7)
    })

    it('should limit requests per minute', async () => {
      const module = await importModule()
      const handler = vi.fn().mockResolvedValue({ items: [], hasMore: true })

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-rpm',
        intervalMs: 100, // Try to poll every 100ms
        rateLimit: {
          requestsPerMinute: 30, // 30 per minute = 0.5 per second
        },
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(10000) // 10 seconds
      await scheduler.stop()

      // At 30/minute = 0.5/second, should have ~5 calls in 10 seconds
      expect(handler.mock.calls.length).toBeLessThanOrEqual(8)
    })

    it('should support token bucket algorithm with burst', async () => {
      const module = await importModule()
      const callTimes: number[] = []
      const handler = vi.fn().mockImplementation(async () => {
        callTimes.push(Date.now())
        return { items: [], hasMore: true }
      })

      vi.setSystemTime(0)

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-token-bucket',
        intervalMs: 10,
        rateLimit: {
          algorithm: 'token-bucket',
          requestsPerSecond: 2,
          burstSize: 5, // Allow burst of 5
        },
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(100) // Very quickly
      await scheduler.stop()

      // Should allow initial burst of up to 5
      expect(handler.mock.calls.length).toBeGreaterThanOrEqual(5)
    })

    it('should support sliding window algorithm', async () => {
      const module = await importModule()
      const handler = vi.fn().mockResolvedValue({ items: [], hasMore: true })

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-sliding-window',
        intervalMs: 100,
        rateLimit: {
          algorithm: 'sliding-window',
          requestsPerSecond: 5,
        },
        handler,
      })

      await scheduler.start()

      // Make 5 requests at end of window
      vi.advanceTimersByTime(800)
      await vi.runAllTimersAsync()

      // At start of next window, sliding window should still count previous
      vi.advanceTimersByTime(400) // Only 200ms into new window
      await scheduler.stop()

      // Sliding window should have limited more aggressively than fixed window
      expect(handler.mock.calls.length).toBeLessThanOrEqual(10)
    })

    it('should track rate limit state', async () => {
      const module = await importModule()
      const handler = vi.fn().mockResolvedValue({ items: [], hasMore: false })

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-rate-state',
        intervalMs: 100,
        rateLimit: {
          requestsPerSecond: 10,
        },
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(200)

      const rateLimitState = scheduler.getRateLimitState()
      expect(rateLimitState).toBeDefined()
      expect(rateLimitState.remainingRequests).toBeDefined()
      expect(rateLimitState.resetAt).toBeDefined()
      expect(typeof rateLimitState.remainingRequests).toBe('number')

      await scheduler.stop()
    })

    it('should emit rate limit events', async () => {
      const module = await importModule()
      const rateLimitEvents: unknown[] = []
      const handler = vi.fn().mockResolvedValue({ items: [], hasMore: true })

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-rate-events',
        intervalMs: 10,
        rateLimit: {
          requestsPerSecond: 2,
        },
        onRateLimited: (event) => rateLimitEvents.push(event),
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(500)
      await scheduler.stop()

      expect(rateLimitEvents.length).toBeGreaterThan(0)
      expect(rateLimitEvents[0]).toMatchObject({
        sourceId: 'test-rate-events',
        waitMs: expect.any(Number),
      })
    })

    it('should apply separate rate limits per source', async () => {
      const module = await importModule()
      const handler1 = vi.fn().mockResolvedValue({ items: [], hasMore: true })
      const handler2 = vi.fn().mockResolvedValue({ items: [], hasMore: true })

      const scheduler1 = module.createIntervalScheduler({
        sourceId: 'source-1',
        intervalMs: 50,
        rateLimit: { requestsPerSecond: 5 },
        handler: handler1,
      })

      const scheduler2 = module.createIntervalScheduler({
        sourceId: 'source-2',
        intervalMs: 50,
        rateLimit: { requestsPerSecond: 20 },
        handler: handler2,
      })

      await Promise.all([scheduler1.start(), scheduler2.start()])
      vi.advanceTimersByTime(1000)
      await Promise.all([scheduler1.stop(), scheduler2.stop()])

      // Source 2 should have more calls due to higher rate limit
      expect(handler2.mock.calls.length).toBeGreaterThan(handler1.mock.calls.length)
    })

    it('should wait for rate limit to reset before retrying', async () => {
      const module = await importModule()
      const callTimes: number[] = []
      const handler = vi.fn().mockImplementation(async () => {
        callTimes.push(Date.now())
        return { items: [], hasMore: true }
      })

      vi.setSystemTime(0)

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-wait-reset',
        intervalMs: 10,
        rateLimit: {
          requestsPerSecond: 2,
        },
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(2000)
      await scheduler.stop()

      // Should see ~2 calls per second with gaps between
      expect(handler.mock.calls.length).toBeGreaterThanOrEqual(3)
      expect(handler.mock.calls.length).toBeLessThanOrEqual(6)
    })
  })

  // ==========================================================================
  // 4. CURSOR/CHECKPOINT STATE TRACKING
  // ==========================================================================

  describe('4. Cursor/checkpoint state tracking', () => {
    it('should persist cursor between polls', async () => {
      const module = await importModule()
      const receivedStates: CheckpointState[] = []

      const handler = vi.fn().mockImplementation(async (state: CheckpointState) => {
        receivedStates.push({ ...state })
        return {
          items: [{ id: receivedStates.length }],
          hasMore: false,
          nextCursor: `cursor-${receivedStates.length}`,
        }
      })

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-cursor',
        intervalMs: 100,
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(350)
      await scheduler.stop()

      expect(receivedStates.length).toBeGreaterThan(1)
      expect(receivedStates[1]?.cursor).toBe('cursor-1')
      expect(receivedStates[2]?.cursor).toBe('cursor-2')
    })

    it('should use initial state from config', async () => {
      const module = await importModule()
      let receivedState: CheckpointState | undefined

      const handler = vi.fn().mockImplementation(async (state: CheckpointState) => {
        receivedState = state
        return { items: [], hasMore: false }
      })

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-initial-state',
        intervalMs: 100,
        initialState: {
          cursor: 'initial-cursor',
          lastSeenId: 'id-100',
        },
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(50)
      await scheduler.stop()

      expect(receivedState?.cursor).toBe('initial-cursor')
      expect(receivedState?.lastSeenId).toBe('id-100')
    })

    it('should track lastSeenId for since_id pagination', async () => {
      const module = await importModule()
      const states: CheckpointState[] = []

      const handler = vi.fn().mockImplementation(async (state: CheckpointState) => {
        states.push({ ...state })
        return {
          items: [{ id: 'new-id-' + states.length }],
          hasMore: false,
        }
      })

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-since-id',
        intervalMs: 100,
        idExtractor: (item: { id: string }) => item.id,
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(250)
      await scheduler.stop()

      expect(states.length).toBeGreaterThan(1)
      expect(states[1]?.lastSeenId).toBe('new-id-1')
    })

    it('should track lastItemTimestamp for timestamp-based pagination', async () => {
      const module = await importModule()
      const states: CheckpointState[] = []

      const handler = vi.fn().mockImplementation(async (state: CheckpointState) => {
        states.push({ ...state })
        return {
          items: [{ id: '1', timestamp: 1000 + states.length * 100 }],
          hasMore: false,
        }
      })

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-timestamp',
        intervalMs: 100,
        timestampExtractor: (item: { timestamp: number }) => item.timestamp,
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(250)
      await scheduler.stop()

      expect(states.length).toBeGreaterThan(1)
      expect(states[1]?.lastItemTimestamp).toBe(1100)
    })

    it('should support custom state fields', async () => {
      const module = await importModule()
      const states: CheckpointState[] = []

      const handler = vi.fn().mockImplementation(async (state: CheckpointState) => {
        states.push({ ...state })
        return {
          items: [],
          hasMore: false,
          customState: {
            pageToken: `token-${states.length}`,
            syncVersion: states.length + 1,
          },
        }
      })

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-custom-state',
        intervalMs: 100,
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(250)
      await scheduler.stop()

      expect(states.length).toBeGreaterThan(1)
      expect(states[1]?.customState?.pageToken).toBe('token-1')
      expect(states[1]?.customState?.syncVersion).toBe(2)
    })

    it('should track lastSuccessAt and lastPollAt timestamps', async () => {
      const module = await importModule()

      vi.setSystemTime(1000)

      const handler = vi.fn().mockResolvedValue({ items: [], hasMore: false })

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-timestamps',
        intervalMs: 100,
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(150)

      const state = scheduler.getCheckpointState()
      expect(state.lastPollAt).toBeGreaterThan(0)
      expect(state.lastSuccessAt).toBeGreaterThan(0)

      await scheduler.stop()
    })

    it('should serialize checkpoint state', async () => {
      const module = await importModule()
      const handler = vi.fn().mockResolvedValue({
        items: [{ id: '1' }],
        hasMore: false,
        nextCursor: 'test-cursor',
      })

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-serialize',
        intervalMs: 100,
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(50)
      await scheduler.stop()

      const serialized = scheduler.serializeCheckpoint()
      expect(typeof serialized).toBe('string')

      const parsed = JSON.parse(serialized)
      expect(parsed.cursor).toBe('test-cursor')
    })

    it('should restore checkpoint state', async () => {
      const module = await importModule()
      let receivedState: CheckpointState | undefined

      const handler = vi.fn().mockImplementation(async (state: CheckpointState) => {
        receivedState = state
        return { items: [], hasMore: false }
      })

      const savedCheckpoint = JSON.stringify({
        cursor: 'restored-cursor',
        lastSeenId: 'restored-id',
        customState: { key: 'value' },
      })

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-restore',
        intervalMs: 100,
        handler,
      })

      scheduler.restoreCheckpoint(savedCheckpoint)
      await scheduler.start()
      vi.advanceTimersByTime(50)
      await scheduler.stop()

      expect(receivedState?.cursor).toBe('restored-cursor')
      expect(receivedState?.lastSeenId).toBe('restored-id')
      expect(receivedState?.customState?.key).toBe('value')
    })

    it('should persist to durable storage when configured', async () => {
      const module = await importModule()
      const mockStorage = {
        put: vi.fn(),
        get: vi.fn().mockResolvedValue(null),
      }

      const handler = vi.fn().mockResolvedValue({
        items: [],
        hasMore: false,
        nextCursor: 'new-cursor',
      })

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-storage',
        intervalMs: 100,
        checkpoint: {
          storage: mockStorage,
          key: 'poll:test-storage',
        },
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(50)
      await scheduler.stop()

      expect(mockStorage.put).toHaveBeenCalledWith(
        'poll:test-storage',
        expect.stringContaining('new-cursor')
      )
    })

    it('should handle checkpoint restore errors gracefully', async () => {
      const module = await importModule()
      const handler = vi.fn().mockResolvedValue({ items: [], hasMore: false })

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-restore-error',
        intervalMs: 100,
        handler,
      })

      // Should not throw on invalid JSON
      expect(() => scheduler.restoreCheckpoint('invalid json {')).not.toThrow()

      await scheduler.start()
      vi.advanceTimersByTime(50)

      // Should have started with empty state
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({}))

      await scheduler.stop()
    })
  })

  // ==========================================================================
  // 5. DEDUPLICATION OF ALREADY-SEEN ITEMS
  // ==========================================================================

  describe('5. Deduplication of already-seen items', () => {
    it('should deduplicate items by ID', async () => {
      const module = await importModule()
      const processedItems: unknown[] = []
      let pollCount = 0

      const handler = vi.fn().mockImplementation(async () => {
        pollCount++
        return {
          items: [
            { id: '1', data: `poll-${pollCount}` },
            { id: '2', data: `poll-${pollCount}` },
          ],
          hasMore: false,
        }
      })

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-dedup',
        intervalMs: 100,
        deduplication: {
          enabled: true,
          keyExtractor: (item: { id: string }) => item.id,
        },
        onItems: (items) => processedItems.push(...items),
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(350)
      await scheduler.stop()

      // Should have received items 1 and 2 only once each
      const ids = processedItems.map((i: any) => i.id)
      expect(ids.filter((id) => id === '1').length).toBe(1)
      expect(ids.filter((id) => id === '2').length).toBe(1)
    })

    it('should support custom dedup key function', async () => {
      const module = await importModule()
      const processedItems: unknown[] = []

      const handler = vi.fn().mockResolvedValue({
        items: [
          { id: '1', hash: 'abc' },
          { id: '2', hash: 'abc' }, // Same hash, different ID
        ],
        hasMore: false,
      })

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-custom-key',
        intervalMs: 100,
        deduplication: {
          enabled: true,
          keyExtractor: (item: { hash: string }) => item.hash, // Dedup by hash
        },
        onItems: (items) => processedItems.push(...items),
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(50)
      await scheduler.stop()

      // Only one item should pass (same hash)
      expect(processedItems.length).toBe(1)
    })

    it('should respect TTL for dedup cache', async () => {
      const module = await importModule()
      const processedItems: unknown[] = []
      let pollCount = 0

      const handler = vi.fn().mockImplementation(async () => {
        pollCount++
        return {
          items: [{ id: '1', data: `poll-${pollCount}` }],
          hasMore: false,
        }
      })

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-dedup-ttl',
        intervalMs: 100,
        deduplication: {
          enabled: true,
          keyExtractor: (item: { id: string }) => item.id,
          ttlMs: 150, // Items expire after 150ms
        },
        onItems: (items) => processedItems.push(...items),
        handler,
      })

      await scheduler.start()

      // First poll - item passes
      vi.advanceTimersByTime(50)
      expect(processedItems.length).toBe(1)

      // Second poll at 150ms - still deduped
      vi.advanceTimersByTime(100)
      expect(processedItems.length).toBe(1)

      // Third poll at 350ms - TTL expired, item passes again
      vi.advanceTimersByTime(200)
      expect(processedItems.length).toBe(2)

      await scheduler.stop()
    })

    it('should respect max entries limit', async () => {
      const module = await importModule()
      const processedItems: unknown[] = []
      let pollCount = 0

      const handler = vi.fn().mockImplementation(async () => {
        pollCount++
        // Each poll returns a new unique item
        return {
          items: [{ id: `unique-${pollCount}` }],
          hasMore: false,
        }
      })

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-max-entries',
        intervalMs: 50,
        deduplication: {
          enabled: true,
          keyExtractor: (item: { id: string }) => item.id,
          maxEntries: 3, // Only track 3 items
        },
        onItems: (items) => processedItems.push(...items),
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(250) // 5 polls
      await scheduler.stop()

      // All items should pass (each is unique)
      expect(processedItems.length).toBe(5)

      // Cache should have evicted old entries
      const dedupState = scheduler.getDeduplicationState()
      expect(dedupState.size).toBeLessThanOrEqual(3)
    })

    it('should track dedup statistics', async () => {
      const module = await importModule()

      const handler = vi.fn().mockResolvedValue({
        items: [
          { id: '1' },
          { id: '2' },
          { id: '1' }, // Duplicate within same batch
        ],
        hasMore: false,
      })

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-dedup-stats',
        intervalMs: 100,
        deduplication: {
          enabled: true,
          keyExtractor: (item: { id: string }) => item.id,
        },
        onItems: () => {},
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(250) // Multiple polls
      await scheduler.stop()

      const metrics = scheduler.getMetrics()
      expect(metrics.deduplicatedCount).toBeGreaterThan(0)
      expect(metrics.itemsBeforeDedup).toBeGreaterThan(metrics.itemsAfterDedup)
    })

    it('should clear dedup cache on demand', async () => {
      const module = await importModule()
      const processedItems: unknown[] = []

      const handler = vi.fn().mockResolvedValue({
        items: [{ id: '1' }],
        hasMore: false,
      })

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-clear-dedup',
        intervalMs: 100,
        deduplication: {
          enabled: true,
          keyExtractor: (item: { id: string }) => item.id,
        },
        onItems: (items) => processedItems.push(...items),
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(50)
      expect(processedItems.length).toBe(1)

      // Clear cache and poll again
      scheduler.clearDeduplicationCache()
      vi.advanceTimersByTime(100)

      // Item should pass again after cache clear
      expect(processedItems.length).toBe(2)

      await scheduler.stop()
    })

    it('should support durable object storage for dedup cache', async () => {
      const module = await importModule()
      const mockStorage = {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn(),
        delete: vi.fn(),
      }

      const handler = vi.fn().mockResolvedValue({
        items: [{ id: '1' }],
        hasMore: false,
      })

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-durable-dedup',
        intervalMs: 100,
        deduplication: {
          enabled: true,
          keyExtractor: (item: { id: string }) => item.id,
          storage: mockStorage,
        },
        onItems: () => {},
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(50)
      await scheduler.stop()

      // Should have persisted dedup entry
      expect(mockStorage.put).toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // 6. BACKOFF ON ERRORS
  // ==========================================================================

  describe('6. Backoff on errors', () => {
    it('should apply exponential backoff on errors', async () => {
      const module = await importModule()
      const callTimes: number[] = []
      const handler = vi.fn().mockImplementation(async () => {
        callTimes.push(Date.now())
        throw new Error('Always fails')
      })

      vi.setSystemTime(0)

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-exp-backoff',
        intervalMs: 100,
        backoff: {
          initialDelayMs: 100,
          maxDelayMs: 10000,
          multiplier: 2,
        },
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(2000)
      await scheduler.stop()

      // Verify exponential increase: intervals should be ~100, ~200, ~400, etc.
      if (callTimes.length >= 4) {
        const intervals = []
        for (let i = 1; i < 4; i++) {
          intervals.push(callTimes[i]! - callTimes[i - 1]!)
        }
        // Each interval should be roughly double the previous (allowing variance)
        expect(intervals[1]! / intervals[0]!).toBeGreaterThan(1.5)
        expect(intervals[2]! / intervals[1]!).toBeGreaterThan(1.5)
      }
    })

    it('should cap backoff at maxDelayMs', async () => {
      const module = await importModule()
      const callTimes: number[] = []
      const handler = vi.fn().mockImplementation(async () => {
        callTimes.push(Date.now())
        throw new Error('Always fails')
      })

      vi.setSystemTime(0)

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-max-backoff',
        intervalMs: 10,
        backoff: {
          initialDelayMs: 100,
          maxDelayMs: 500, // Cap at 500ms
          multiplier: 2,
        },
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(5000)
      await scheduler.stop()

      // Later intervals should not exceed 500ms (+ some variance)
      if (callTimes.length >= 6) {
        const laterInterval = callTimes[callTimes.length - 1]! - callTimes[callTimes.length - 2]!
        expect(laterInterval).toBeLessThanOrEqual(600)
      }
    })

    it('should add jitter to backoff', async () => {
      const module = await importModule()
      const intervals: number[] = []

      // Run multiple tests to check jitter variance
      for (let run = 0; run < 5; run++) {
        const callTimes: number[] = []
        const handler = vi.fn().mockImplementation(async () => {
          callTimes.push(Date.now())
          throw new Error('Fails')
        })

        vi.setSystemTime(0)

        const scheduler = module.createIntervalScheduler({
          sourceId: `test-jitter-${run}`,
          intervalMs: 10,
          backoff: {
            initialDelayMs: 100,
            maxDelayMs: 1000,
            multiplier: 1, // No multiplier to isolate jitter
            jitter: 0.5, // 50% jitter
          },
          handler,
        })

        await scheduler.start()
        vi.advanceTimersByTime(300)
        await scheduler.stop()

        if (callTimes.length >= 2) {
          intervals.push(callTimes[1]! - callTimes[0]!)
        }
      }

      // With jitter, intervals should vary
      const uniqueIntervals = new Set(intervals.map((i) => Math.round(i / 10) * 10))
      expect(uniqueIntervals.size).toBeGreaterThan(1)
    })

    it('should reset backoff on successful poll', async () => {
      const module = await importModule()
      let failCount = 3
      const callTimes: number[] = []

      const handler = vi.fn().mockImplementation(async () => {
        callTimes.push(Date.now())
        if (failCount > 0) {
          failCount--
          throw new Error('Temporary failure')
        }
        return { items: [], hasMore: false }
      })

      vi.setSystemTime(0)

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-backoff-reset',
        intervalMs: 100,
        backoff: {
          initialDelayMs: 50,
          maxDelayMs: 1000,
          multiplier: 2,
        },
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(3000)
      await scheduler.stop()

      const state = scheduler.getBackoffState()
      expect(state.consecutiveErrors).toBe(0)
      expect(state.currentDelayMs).toBe(0)
    })

    it('should track consecutive error count', async () => {
      const module = await importModule()
      const handler = vi.fn().mockRejectedValue(new Error('Always fails'))

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-error-count',
        intervalMs: 100,
        backoff: {
          initialDelayMs: 50,
          maxDelayMs: 200,
          multiplier: 2,
        },
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(500)
      await scheduler.stop()

      const state = scheduler.getBackoffState()
      expect(state.consecutiveErrors).toBeGreaterThan(0)
    })

    it('should emit error events with backoff info', async () => {
      const module = await importModule()
      const errorEvents: unknown[] = []
      const handler = vi.fn().mockRejectedValue(new Error('Poll error'))

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-error-events',
        intervalMs: 100,
        backoff: {
          initialDelayMs: 100,
          maxDelayMs: 1000,
          multiplier: 2,
        },
        onError: (error, backoffInfo) => {
          errorEvents.push({ error, backoffInfo })
        },
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(300)
      await scheduler.stop()

      expect(errorEvents.length).toBeGreaterThan(0)
      expect(errorEvents[0]).toMatchObject({
        error: expect.any(Error),
        backoffInfo: {
          attempt: expect.any(Number),
          nextDelayMs: expect.any(Number),
        },
      })
    })

    it('should stop after maxRetries', async () => {
      const module = await importModule()
      let gaveUp = false
      const handler = vi.fn().mockRejectedValue(new Error('Always fails'))

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-max-retries',
        intervalMs: 50,
        backoff: {
          initialDelayMs: 10,
          maxDelayMs: 100,
          multiplier: 2,
          maxRetries: 3,
        },
        onGiveUp: () => {
          gaveUp = true
        },
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(1000)
      await scheduler.stop()

      expect(gaveUp).toBe(true)
      expect(handler.mock.calls.length).toBeLessThanOrEqual(4)
    })

    it('should support circuit breaker pattern', async () => {
      const module = await importModule()
      const handler = vi.fn().mockRejectedValue(new Error('Service unavailable'))

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-circuit-breaker',
        intervalMs: 50,
        backoff: {
          initialDelayMs: 10,
          maxDelayMs: 100,
          multiplier: 2,
        },
        circuitBreaker: {
          failureThreshold: 3,
          resetTimeoutMs: 500,
        },
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(200) // Trigger circuit open
      await scheduler.stop()

      const state = scheduler.getCircuitState()
      expect(state).toBe('open')

      // After reset timeout, should be half-open
      await scheduler.start()
      vi.advanceTimersByTime(600)
      const newState = scheduler.getCircuitState()
      expect(newState).toBe('half-open')

      await scheduler.stop()
    })
  })

  // ==========================================================================
  // 7. CONCURRENT POLL PREVENTION
  // ==========================================================================

  describe('7. Concurrent poll prevention', () => {
    it('should not start new poll while one is in progress', async () => {
      const module = await importModule()
      let concurrentCalls = 0
      let maxConcurrent = 0

      const handler = vi.fn().mockImplementation(async () => {
        concurrentCalls++
        maxConcurrent = Math.max(maxConcurrent, concurrentCalls)
        // Simulate long-running poll
        await new Promise((r) => setTimeout(r, 200))
        concurrentCalls--
        return { items: [], hasMore: false }
      })

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-no-concurrent',
        intervalMs: 50, // Faster than handler
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(500)
      await vi.runAllTimersAsync()
      await scheduler.stop()

      expect(maxConcurrent).toBe(1)
    })

    it('should report isPolling state', async () => {
      const module = await importModule()
      const handler = vi.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 100))
        return { items: [], hasMore: false }
      })

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-is-polling',
        intervalMs: 500,
        handler,
      })

      expect(scheduler.isPolling()).toBe(false)

      await scheduler.start()
      vi.advanceTimersByTime(50)

      expect(scheduler.isPolling()).toBe(true)

      vi.advanceTimersByTime(100)
      await vi.runAllTimersAsync()

      expect(scheduler.isPolling()).toBe(false)

      await scheduler.stop()
    })

    it('should queue manual poll requests', async () => {
      const module = await importModule()
      let pollCount = 0
      const handler = vi.fn().mockImplementation(async () => {
        pollCount++
        await new Promise((r) => setTimeout(r, 100))
        return { items: [{ id: pollCount }], hasMore: false }
      })

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-manual-queue',
        intervalMs: 500,
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(50) // First poll starts

      // Trigger multiple manual polls while first is running
      const manualResults = Promise.all([
        scheduler.pollNow(),
        scheduler.pollNow(),
        scheduler.pollNow(),
      ])

      vi.advanceTimersByTime(500)
      await vi.runAllTimersAsync()
      await manualResults

      // Should have executed polls sequentially, not concurrently
      expect(handler.mock.calls.length).toBeLessThanOrEqual(4)

      await scheduler.stop()
    })

    it('should support force poll that skips queue', async () => {
      const module = await importModule()
      const callOrder: number[] = []

      const handler = vi.fn().mockImplementation(async () => {
        const id = handler.mock.calls.length
        callOrder.push(id)
        await new Promise((r) => setTimeout(r, 50))
        return { items: [], hasMore: false }
      })

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-force-poll',
        intervalMs: 1000,
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(50) // First poll starts

      // Force poll should execute immediately (or cancel current)
      await scheduler.forcePoll()

      vi.advanceTimersByTime(100)
      await vi.runAllTimersAsync()
      await scheduler.stop()

      expect(handler.mock.calls.length).toBeGreaterThanOrEqual(2)
    })

    it('should track pending poll requests', async () => {
      const module = await importModule()
      const handler = vi.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 200))
        return { items: [], hasMore: false }
      })

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-pending',
        intervalMs: 100,
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(50)

      // Queue some manual polls
      scheduler.pollNow()
      scheduler.pollNow()

      expect(scheduler.getPendingPollCount()).toBeGreaterThanOrEqual(1)

      vi.advanceTimersByTime(500)
      await vi.runAllTimersAsync()
      await scheduler.stop()
    })

    it('should cancel pending polls on stop', async () => {
      const module = await importModule()
      const handler = vi.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 200))
        return { items: [], hasMore: false }
      })

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-cancel-pending',
        intervalMs: 50,
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(100)

      const callsBeforeStop = handler.mock.calls.length
      await scheduler.stop()

      vi.advanceTimersByTime(500)
      await vi.runAllTimersAsync()

      // No new polls should have executed after stop
      expect(handler.mock.calls.length).toBe(callsBeforeStop)
    })

    it('should wait for in-flight poll on graceful stop', async () => {
      const module = await importModule()
      let pollCompleted = false

      const handler = vi.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 100))
        pollCompleted = true
        return { items: [], hasMore: false }
      })

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-graceful-stop',
        intervalMs: 500,
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(50) // Poll starts

      const stopPromise = scheduler.stop({ graceful: true })
      vi.advanceTimersByTime(150)
      await vi.runAllTimersAsync()
      await stopPromise

      expect(pollCompleted).toBe(true)
    })

    it('should support poll timeout', async () => {
      const module = await importModule()
      let timedOut = false

      const handler = vi.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 1000)) // Long poll
        return { items: [], hasMore: false }
      })

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-timeout',
        intervalMs: 500,
        pollTimeoutMs: 200,
        onTimeout: () => {
          timedOut = true
        },
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(300)
      await vi.runAllTimersAsync()
      await scheduler.stop()

      expect(timedOut).toBe(true)
    })
  })

  // ==========================================================================
  // 8. POLLING HISTORY/AUDIT LOG
  // ==========================================================================

  describe('8. Polling history/audit log', () => {
    it('should maintain poll history', async () => {
      const module = await importModule()
      let pollCount = 0
      const handler = vi.fn().mockImplementation(async () => {
        pollCount++
        return {
          items: [{ id: pollCount }],
          hasMore: false,
        }
      })

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-history',
        intervalMs: 100,
        auditLog: {
          enabled: true,
          maxEntries: 10,
        },
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(350)
      await scheduler.stop()

      const history = scheduler.getAuditLog()
      expect(history.length).toBeGreaterThanOrEqual(3)
    })

    it('should limit history size', async () => {
      const module = await importModule()
      const handler = vi.fn().mockResolvedValue({ items: [], hasMore: false })

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-history-limit',
        intervalMs: 50,
        auditLog: {
          enabled: true,
          maxEntries: 5,
        },
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(500) // ~10 polls
      await scheduler.stop()

      const history = scheduler.getAuditLog()
      expect(history.length).toBeLessThanOrEqual(5)
    })

    it('should record poll duration', async () => {
      const module = await importModule()
      const handler = vi.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 50))
        return { items: [], hasMore: false }
      })

      vi.setSystemTime(0)

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-duration',
        intervalMs: 200,
        auditLog: {
          enabled: true,
        },
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(100)
      await vi.runAllTimersAsync()
      await scheduler.stop()

      const history = scheduler.getAuditLog()
      expect(history.length).toBeGreaterThan(0)
      expect(history[0]!.durationMs).toBeGreaterThanOrEqual(40)
    })

    it('should record item count per poll', async () => {
      const module = await importModule()
      let pollCount = 0
      const handler = vi.fn().mockImplementation(async () => {
        pollCount++
        return {
          items: Array(pollCount).fill({ id: pollCount }),
          hasMore: false,
        }
      })

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-item-count',
        intervalMs: 100,
        auditLog: {
          enabled: true,
        },
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(350)
      await scheduler.stop()

      const history = scheduler.getAuditLog()
      expect(history[0]!.itemCount).toBe(1)
      expect(history[1]!.itemCount).toBe(2)
      expect(history[2]!.itemCount).toBe(3)
    })

    it('should record success/failure status', async () => {
      const module = await importModule()
      let shouldFail = true
      const handler = vi.fn().mockImplementation(async () => {
        if (shouldFail) {
          shouldFail = false
          throw new Error('First poll fails')
        }
        return { items: [], hasMore: false }
      })

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-status',
        intervalMs: 100,
        backoff: { initialDelayMs: 50 },
        auditLog: {
          enabled: true,
        },
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(250)
      await scheduler.stop()

      const history = scheduler.getAuditLog()
      const failed = history.find((h) => !h.success)
      const succeeded = history.find((h) => h.success)

      expect(failed).toBeDefined()
      expect(failed!.error).toBe('First poll fails')
      expect(succeeded).toBeDefined()
    })

    it('should record checkpoint state after each poll', async () => {
      const module = await importModule()
      let pollCount = 0
      const handler = vi.fn().mockImplementation(async () => {
        pollCount++
        return {
          items: [{ id: pollCount }],
          hasMore: false,
          nextCursor: `cursor-${pollCount}`,
        }
      })

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-checkpoint-log',
        intervalMs: 100,
        auditLog: {
          enabled: true,
        },
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(250)
      await scheduler.stop()

      const history = scheduler.getAuditLog()
      expect(history[0]!.checkpointState.cursor).toBe('cursor-1')
      expect(history[1]!.checkpointState.cursor).toBe('cursor-2')
    })

    it('should include rate limit state in audit log', async () => {
      const module = await importModule()
      const handler = vi.fn().mockResolvedValue({ items: [], hasMore: false })

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-rate-limit-log',
        intervalMs: 100,
        rateLimit: {
          requestsPerSecond: 10,
        },
        auditLog: {
          enabled: true,
        },
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(150)
      await scheduler.stop()

      const history = scheduler.getAuditLog()
      expect(history[0]!.rateLimitState).toBeDefined()
      expect(history[0]!.rateLimitState!.remainingRequests).toBeDefined()
    })

    it('should generate unique poll IDs', async () => {
      const module = await importModule()
      const handler = vi.fn().mockResolvedValue({ items: [], hasMore: false })

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-poll-ids',
        intervalMs: 50,
        auditLog: {
          enabled: true,
        },
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(200)
      await scheduler.stop()

      const history = scheduler.getAuditLog()
      const pollIds = history.map((h) => h.pollId)
      const uniqueIds = new Set(pollIds)

      expect(uniqueIds.size).toBe(pollIds.length)
    })

    it('should support querying history by time range', async () => {
      const module = await importModule()
      const handler = vi.fn().mockResolvedValue({ items: [], hasMore: false })

      vi.setSystemTime(0)

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-query-history',
        intervalMs: 100,
        auditLog: {
          enabled: true,
        },
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(500)
      await scheduler.stop()

      const recentHistory = scheduler.getAuditLog({
        from: 200,
        to: 400,
      })

      expect(recentHistory.every((h) => h.startedAt >= 200 && h.startedAt <= 400)).toBe(true)
    })

    it('should support durable storage for audit log', async () => {
      const module = await importModule()
      const mockStorage = {
        put: vi.fn(),
        get: vi.fn().mockResolvedValue([]),
        list: vi.fn().mockResolvedValue([]),
      }

      const handler = vi.fn().mockResolvedValue({ items: [], hasMore: false })

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-durable-audit',
        intervalMs: 100,
        auditLog: {
          enabled: true,
          storage: mockStorage,
        },
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(50)
      await scheduler.stop()

      expect(mockStorage.put).toHaveBeenCalled()
    })

    it('should clear audit log on demand', async () => {
      const module = await importModule()
      const handler = vi.fn().mockResolvedValue({ items: [], hasMore: false })

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-clear-audit',
        intervalMs: 100,
        auditLog: {
          enabled: true,
        },
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(250)

      expect(scheduler.getAuditLog().length).toBeGreaterThan(0)

      scheduler.clearAuditLog()

      expect(scheduler.getAuditLog().length).toBe(0)

      await scheduler.stop()
    })

    it('should export audit log as JSON', async () => {
      const module = await importModule()
      const handler = vi.fn().mockResolvedValue({ items: [], hasMore: false })

      const scheduler = module.createIntervalScheduler({
        sourceId: 'test-export-audit',
        intervalMs: 100,
        auditLog: {
          enabled: true,
        },
        handler,
      })

      await scheduler.start()
      vi.advanceTimersByTime(150)
      await scheduler.stop()

      const exported = scheduler.exportAuditLog()
      expect(typeof exported).toBe('string')

      const parsed = JSON.parse(exported)
      expect(Array.isArray(parsed)).toBe(true)
      expect(parsed[0].sourceId).toBe('test-export-audit')
    })
  })

  // ==========================================================================
  // ADDITIONAL: Module Exports
  // ==========================================================================

  describe('Module exports', () => {
    it('should export createPollingScheduler factory', async () => {
      const module = await importModule()
      expect(module.createPollingScheduler).toBeDefined()
      expect(typeof module.createPollingScheduler).toBe('function')
    })

    it('should export PollingScheduler class', async () => {
      const module = await importModule()
      expect(module.PollingScheduler).toBeDefined()
    })

    it('should export type definitions', async () => {
      const module = await importModule()
      // Type exports should be available for TypeScript compilation
      // This test verifies the module structure
      expect(module).toBeDefined()
    })
  })
})
