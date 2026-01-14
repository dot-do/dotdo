/**
 * ConnectorFramework Infrastructure Tests
 *
 * TDD tests for:
 * - State management and recovery (dotdo-oe0oo)
 * - Rate limiting and quotas (dotdo-nx6sv)
 * - Schema mapping enhancements (dotdo-0qyo3)
 *
 * @module db/primitives/connector-framework/infrastructure
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// =============================================================================
// State Management and Recovery Tests (dotdo-oe0oo)
// =============================================================================

import {
  type StateManager,
  type StateStore,
  type PersistedState,
  type StateVersion,
  type StateMigration,
  createStateManager,
  createMemoryStateStore,
  type SyncState,
  type StreamState,
  type GlobalState,
} from './state'

describe('StateManager', () => {
  let stateManager: StateManager
  let stateStore: StateStore

  beforeEach(() => {
    stateStore = createMemoryStateStore()
    stateManager = createStateManager({ store: stateStore })
  })

  describe('per-stream state tracking', () => {
    it('should track state for individual streams', async () => {
      const streamState: StreamState = {
        streamDescriptor: { name: 'users', namespace: 'public' },
        streamState: { cursor: '2024-01-15T00:00:00Z', lastId: 1000 },
      }

      await stateManager.setStreamState('sync-123', streamState)
      const retrieved = await stateManager.getStreamState('sync-123', 'users', 'public')

      expect(retrieved).toEqual(streamState.streamState)
    })

    it('should track multiple streams independently', async () => {
      await stateManager.setStreamState('sync-123', {
        streamDescriptor: { name: 'users' },
        streamState: { cursor: 100 },
      })
      await stateManager.setStreamState('sync-123', {
        streamDescriptor: { name: 'orders' },
        streamState: { cursor: 200 },
      })

      const usersState = await stateManager.getStreamState('sync-123', 'users')
      const ordersState = await stateManager.getStreamState('sync-123', 'orders')

      expect(usersState?.cursor).toBe(100)
      expect(ordersState?.cursor).toBe(200)
    })

    it('should return undefined for non-existent stream state', async () => {
      const state = await stateManager.getStreamState('sync-123', 'non-existent')
      expect(state).toBeUndefined()
    })
  })

  describe('global vs stream-level state', () => {
    it('should support global state with shared data', async () => {
      const globalState: GlobalState = {
        sharedState: { syncId: 'abc123', startedAt: '2024-01-15T00:00:00Z' },
        streamStates: [
          { streamDescriptor: { name: 'users' }, streamState: { cursor: 100 } },
          { streamDescriptor: { name: 'orders' }, streamState: { cursor: 200 } },
        ],
      }

      await stateManager.setGlobalState('sync-123', globalState)
      const retrieved = await stateManager.getGlobalState('sync-123')

      expect(retrieved?.sharedState?.syncId).toBe('abc123')
      expect(retrieved?.streamStates).toHaveLength(2)
    })

    it('should merge stream state into global state', async () => {
      // Set initial global state
      await stateManager.setGlobalState('sync-123', {
        sharedState: { version: 1 },
        streamStates: [{ streamDescriptor: { name: 'users' }, streamState: { cursor: 100 } }],
      })

      // Update individual stream
      await stateManager.setStreamState('sync-123', {
        streamDescriptor: { name: 'users' },
        streamState: { cursor: 150 },
      })

      const globalState = await stateManager.getGlobalState('sync-123')
      const usersStream = globalState?.streamStates.find((s) => s.streamDescriptor.name === 'users')

      expect(usersStream?.streamState.cursor).toBe(150)
    })
  })

  describe('state serialization format', () => {
    it('should serialize state with version metadata', async () => {
      await stateManager.setStreamState('sync-123', {
        streamDescriptor: { name: 'users' },
        streamState: { cursor: 100 },
      })

      const persisted = await stateStore.load('sync-123')

      expect(persisted?.version).toBeDefined()
      expect(persisted?.version.major).toBeGreaterThanOrEqual(1)
      expect(persisted?.createdAt).toBeInstanceOf(Date)
      expect(persisted?.updatedAt).toBeInstanceOf(Date)
    })

    it('should include checksum for data integrity', async () => {
      await stateManager.setStreamState('sync-123', {
        streamDescriptor: { name: 'users' },
        streamState: { cursor: 100 },
      })

      const persisted = await stateStore.load('sync-123')

      expect(persisted?.checksum).toBeDefined()
      expect(typeof persisted?.checksum).toBe('string')
    })

    it('should detect corrupted state via checksum', async () => {
      await stateManager.setStreamState('sync-123', {
        streamDescriptor: { name: 'users' },
        streamState: { cursor: 100 },
      })

      // Manually corrupt the state
      const persisted = await stateStore.load('sync-123')
      if (persisted) {
        persisted.checksum = 'invalid-checksum'
        await stateStore.save('sync-123', persisted)
      }

      await expect(stateManager.getStreamState('sync-123', 'users')).rejects.toThrow(/checksum/i)
    })
  })

  describe('recovery from partial syncs', () => {
    it('should create checkpoints during sync', async () => {
      const checkpoint1 = await stateManager.createCheckpoint('sync-123', {
        streams: { users: { cursor: 50, recordsProcessed: 50 } },
      })

      const checkpoint2 = await stateManager.createCheckpoint('sync-123', {
        streams: { users: { cursor: 100, recordsProcessed: 100 } },
      })

      expect(checkpoint1.id).toBeDefined()
      expect(checkpoint2.id).toBeDefined()
      expect(checkpoint2.id).not.toBe(checkpoint1.id)
    })

    it('should recover from last valid checkpoint after failure', async () => {
      // Create checkpoints
      await stateManager.createCheckpoint('sync-123', {
        streams: { users: { cursor: 50 } },
      })
      await stateManager.createCheckpoint('sync-123', {
        streams: { users: { cursor: 100 } },
      })

      // Simulate failure and recovery
      const recoveredState = await stateManager.recoverFromCheckpoint('sync-123')

      expect(recoveredState?.streams?.users?.cursor).toBe(100)
    })

    it('should list available checkpoints', async () => {
      await stateManager.createCheckpoint('sync-123', { streams: { users: { cursor: 50 } } })
      await stateManager.createCheckpoint('sync-123', { streams: { users: { cursor: 100 } } })
      await stateManager.createCheckpoint('sync-123', { streams: { users: { cursor: 150 } } })

      const checkpoints = await stateManager.listCheckpoints('sync-123')

      expect(checkpoints).toHaveLength(3)
      expect(checkpoints[2].state.streams.users.cursor).toBe(150)
    })

    it('should rollback to specific checkpoint', async () => {
      const cp1 = await stateManager.createCheckpoint('sync-123', { streams: { users: { cursor: 50 } } })
      await stateManager.createCheckpoint('sync-123', { streams: { users: { cursor: 100 } } })

      await stateManager.rollbackToCheckpoint('sync-123', cp1.id)
      const currentState = await stateManager.getCurrentState('sync-123')

      expect(currentState?.streams?.users?.cursor).toBe(50)
    })

    it('should clean up old checkpoints based on retention policy', async () => {
      const retention = { maxCheckpoints: 2 }
      stateManager = createStateManager({ store: stateStore, checkpointRetention: retention })

      await stateManager.createCheckpoint('sync-123', { streams: { users: { cursor: 50 } } })
      await stateManager.createCheckpoint('sync-123', { streams: { users: { cursor: 100 } } })
      await stateManager.createCheckpoint('sync-123', { streams: { users: { cursor: 150 } } })

      const checkpoints = await stateManager.listCheckpoints('sync-123')

      expect(checkpoints).toHaveLength(2)
      expect(checkpoints[0].state.streams.users.cursor).toBe(100)
    })
  })

  describe('state migration between versions', () => {
    it('should migrate state from v1 to v2 format', async () => {
      // Manually save v1 format state
      const v1State: PersistedState = {
        version: { major: 1, minor: 0, patch: 0 },
        data: { streams: { users: { offset: 100 } } },
        createdAt: new Date(),
        updatedAt: new Date(),
        checksum: 'valid',
      }
      await stateStore.save('sync-123', v1State)

      // Define migration
      const migration: StateMigration = {
        fromVersion: { major: 1, minor: 0, patch: 0 },
        toVersion: { major: 2, minor: 0, patch: 0 },
        migrate: (data) => ({
          streams: Object.fromEntries(
            Object.entries(data.streams as Record<string, { offset: number }>).map(([k, v]) => [k, { cursor: v.offset }]),
          ),
        }),
      }

      stateManager = createStateManager({ store: stateStore, migrations: [migration] })

      const state = await stateManager.getCurrentState('sync-123')

      expect(state?.streams?.users?.cursor).toBe(100)
      expect(state?.streams?.users).not.toHaveProperty('offset')
    })

    it('should apply multiple migrations in sequence', async () => {
      const v1State: PersistedState = {
        version: { major: 1, minor: 0, patch: 0 },
        data: { cursors: { users: 100 } },
        createdAt: new Date(),
        updatedAt: new Date(),
        checksum: 'valid',
      }
      await stateStore.save('sync-123', v1State)

      const migrations: StateMigration[] = [
        {
          fromVersion: { major: 1, minor: 0, patch: 0 },
          toVersion: { major: 1, minor: 1, patch: 0 },
          migrate: (data) => ({ ...data, format: 'v1.1' }),
        },
        {
          fromVersion: { major: 1, minor: 1, patch: 0 },
          toVersion: { major: 2, minor: 0, patch: 0 },
          migrate: (data) => ({
            streams: Object.fromEntries(
              Object.entries(data.cursors as Record<string, number>).map(([k, v]) => [k, { cursor: v }]),
            ),
            migrated: true,
          }),
        },
      ]

      stateManager = createStateManager({ store: stateStore, migrations })

      const state = await stateManager.getCurrentState('sync-123')

      expect((state as any).migrated).toBe(true)
      expect(state?.streams?.users?.cursor).toBe(100)
    })

    it('should fail gracefully if migration path is missing', async () => {
      const v1State: PersistedState = {
        version: { major: 1, minor: 0, patch: 0 },
        data: { streams: {} },
        createdAt: new Date(),
        updatedAt: new Date(),
        checksum: 'valid',
      }
      await stateStore.save('sync-123', v1State)

      // No migrations provided for v1 -> current
      stateManager = createStateManager({ store: stateStore, migrations: [] })

      await expect(stateManager.getCurrentState('sync-123')).rejects.toThrow(/migration/i)
    })
  })
})

// =============================================================================
// Rate Limiting and Quotas Tests (dotdo-nx6sv)
// =============================================================================

import {
  type RateLimiter,
  type RateLimiterConfig,
  type QuotaManager,
  type QuotaConfig,
  type RetryConfig,
  type RateLimitInfo,
  createTokenBucketRateLimiter,
  createQuotaManager,
  createRetryWithBackoff,
  parseRateLimitHeaders,
  type RetryResult,
} from './rate-limiting'

describe('TokenBucketRateLimiter', () => {
  let rateLimiter: RateLimiter

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('basic rate limiting', () => {
    it('should allow requests within rate limit', async () => {
      rateLimiter = createTokenBucketRateLimiter({
        maxTokens: 10,
        refillRate: 1, // 1 token per second
        refillInterval: 1000,
      })

      // Should allow 10 requests immediately
      for (let i = 0; i < 10; i++) {
        const result = await rateLimiter.acquire()
        expect(result.allowed).toBe(true)
      }
    })

    it('should block requests when bucket is empty', async () => {
      rateLimiter = createTokenBucketRateLimiter({
        maxTokens: 2,
        refillRate: 1,
        refillInterval: 1000,
      })

      await rateLimiter.acquire()
      await rateLimiter.acquire()

      const result = await rateLimiter.acquire()

      expect(result.allowed).toBe(false)
      expect(result.retryAfter).toBeGreaterThan(0)
    })

    it('should refill tokens over time', async () => {
      rateLimiter = createTokenBucketRateLimiter({
        maxTokens: 2,
        refillRate: 1,
        refillInterval: 1000,
      })

      await rateLimiter.acquire()
      await rateLimiter.acquire()

      // Advance time by 1 second
      vi.advanceTimersByTime(1000)

      const result = await rateLimiter.acquire()
      expect(result.allowed).toBe(true)
    })

    it('should not exceed max tokens when refilling', async () => {
      rateLimiter = createTokenBucketRateLimiter({
        maxTokens: 5,
        refillRate: 2,
        refillInterval: 1000,
      })

      // Advance time significantly
      vi.advanceTimersByTime(10000)

      // Should only have 5 tokens max
      const info = await rateLimiter.getStatus()
      expect(info.availableTokens).toBe(5)
    })
  })

  describe('burst handling', () => {
    it('should support burst capacity', async () => {
      rateLimiter = createTokenBucketRateLimiter({
        maxTokens: 10,
        refillRate: 1,
        refillInterval: 1000,
        burstCapacity: 5, // Allow 5 extra requests in burst
      })

      // Should allow 15 requests in burst (10 + 5)
      for (let i = 0; i < 15; i++) {
        const result = await rateLimiter.acquire()
        expect(result.allowed).toBe(true)
      }

      // 16th should be blocked
      const result = await rateLimiter.acquire()
      expect(result.allowed).toBe(false)
    })
  })

  describe('request cost', () => {
    it('should support variable request costs', async () => {
      rateLimiter = createTokenBucketRateLimiter({
        maxTokens: 10,
        refillRate: 1,
        refillInterval: 1000,
      })

      // Request with cost of 5 tokens
      const result1 = await rateLimiter.acquire(5)
      expect(result1.allowed).toBe(true)

      // Another request with cost of 5
      const result2 = await rateLimiter.acquire(5)
      expect(result2.allowed).toBe(true)

      // Third request should fail (no tokens left)
      const result3 = await rateLimiter.acquire(1)
      expect(result3.allowed).toBe(false)
    })
  })

  describe('waitForToken', () => {
    it('should wait for token to become available', async () => {
      rateLimiter = createTokenBucketRateLimiter({
        maxTokens: 1,
        refillRate: 1,
        refillInterval: 1000,
      })

      await rateLimiter.acquire()

      // Start waiting for token
      const waitPromise = rateLimiter.waitForToken()

      // Should not resolve immediately
      let resolved = false
      waitPromise.then(() => {
        resolved = true
      })

      await vi.advanceTimersByTimeAsync(500)
      expect(resolved).toBe(false)

      await vi.advanceTimersByTimeAsync(500)
      expect(resolved).toBe(true)
    })

    it('should timeout if token not available within limit', async () => {
      rateLimiter = createTokenBucketRateLimiter({
        maxTokens: 1,
        refillRate: 1,
        refillInterval: 10000, // 10 seconds
      })

      await rateLimiter.acquire()

      await expect(rateLimiter.waitForToken({ timeout: 1000 })).rejects.toThrow(/timeout/i)
    })
  })
})

describe('RetryWithBackoff', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('exponential backoff', () => {
    it('should retry with exponential backoff', async () => {
      let attempts = 0
      const operation = vi.fn(async () => {
        attempts++
        if (attempts < 3) {
          throw new Error('Temporary failure')
        }
        return 'success'
      })

      const retry = createRetryWithBackoff({
        maxRetries: 5,
        initialDelayMs: 100,
        maxDelayMs: 10000,
        backoffMultiplier: 2,
      })

      const resultPromise = retry.execute(operation)

      // First attempt fails immediately
      await vi.advanceTimersByTimeAsync(0)

      // Wait for first retry (100ms)
      await vi.advanceTimersByTimeAsync(100)

      // Wait for second retry (200ms)
      await vi.advanceTimersByTimeAsync(200)

      const result = await resultPromise

      expect(result.success).toBe(true)
      expect(result.value).toBe('success')
      expect(result.attempts).toBe(3)
    })

    it('should respect max delay cap', async () => {
      const delays: number[] = []
      const operation = vi.fn(async () => {
        throw new Error('Always fails')
      })

      const retry = createRetryWithBackoff({
        maxRetries: 5,
        initialDelayMs: 1000,
        maxDelayMs: 3000, // Cap at 3 seconds
        backoffMultiplier: 2,
        onRetry: (attempt, delay) => delays.push(delay),
      })

      const resultPromise = retry.execute(operation)

      // Advance through all retries
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(5000)
      }

      await resultPromise.catch(() => {})

      // Delays should be capped at 3000ms
      expect(delays.every((d) => d <= 3000)).toBe(true)
    })

    it('should add jitter to prevent thundering herd', async () => {
      const delays: number[] = []

      const retry = createRetryWithBackoff({
        maxRetries: 5,
        initialDelayMs: 1000,
        maxDelayMs: 10000,
        backoffMultiplier: 2,
        jitter: true,
        onRetry: (attempt, delay) => delays.push(delay),
      })

      // Run multiple times to check variance
      for (let i = 0; i < 3; i++) {
        delays.length = 0
        const operation = vi.fn(async () => {
          throw new Error('Fails')
        })

        const resultPromise = retry.execute(operation)
        for (let j = 0; j < 5; j++) {
          await vi.advanceTimersByTimeAsync(15000)
        }
        await resultPromise.catch(() => {})
      }

      // With jitter, delays should have some variance
      // This is a probabilistic test - with jitter, not all delays should be identical
      const uniqueDelays = new Set(delays)
      expect(uniqueDelays.size).toBeGreaterThan(1)
    })
  })

  describe('retry conditions', () => {
    it('should only retry on retriable errors', async () => {
      let attempts = 0
      const operation = vi.fn(async () => {
        attempts++
        if (attempts === 1) {
          const error = new Error('Not found')
          ;(error as any).statusCode = 404
          throw error
        }
        return 'success'
      })

      const retry = createRetryWithBackoff({
        maxRetries: 3,
        initialDelayMs: 100,
        shouldRetry: (error) => {
          return (error as any).statusCode !== 404
        },
      })

      const result = await retry.execute(operation)

      expect(result.success).toBe(false)
      expect(result.attempts).toBe(1) // Should not retry 404
    })

    it('should retry on 429 Too Many Requests', async () => {
      let attempts = 0
      const operation = vi.fn(async () => {
        attempts++
        if (attempts < 3) {
          const error = new Error('Too Many Requests')
          ;(error as any).statusCode = 429
          throw error
        }
        return 'success'
      })

      const retry = createRetryWithBackoff({
        maxRetries: 5,
        initialDelayMs: 100,
      })

      const resultPromise = retry.execute(operation)

      // Advance through retries
      for (let i = 0; i < 3; i++) {
        await vi.advanceTimersByTimeAsync(1000)
      }

      const result = await resultPromise

      expect(result.success).toBe(true)
      expect(result.attempts).toBe(3)
    })
  })

  describe('circuit breaker', () => {
    it('should open circuit after consecutive failures', async () => {
      const operation = vi.fn(async () => {
        throw new Error('Service unavailable')
      })

      const retry = createRetryWithBackoff({
        maxRetries: 1,
        initialDelayMs: 100,
        circuitBreaker: {
          failureThreshold: 3,
          resetTimeoutMs: 5000,
        },
      })

      // First 3 calls trigger circuit breaker
      for (let i = 0; i < 3; i++) {
        const resultPromise = retry.execute(operation)
        await vi.advanceTimersByTimeAsync(1000)
        await resultPromise.catch(() => {})
      }

      // Circuit should be open now
      const result = await retry.execute(operation)

      expect(result.success).toBe(false)
      expect(result.error?.message).toMatch(/circuit.*open/i)
    })

    it('should close circuit after reset timeout', async () => {
      let shouldFail = true
      const operation = vi.fn(async () => {
        if (shouldFail) throw new Error('Service unavailable')
        return 'success'
      })

      const retry = createRetryWithBackoff({
        maxRetries: 1,
        initialDelayMs: 100,
        circuitBreaker: {
          failureThreshold: 2,
          resetTimeoutMs: 5000,
        },
      })

      // Trigger circuit breaker
      for (let i = 0; i < 2; i++) {
        const resultPromise = retry.execute(operation)
        await vi.advanceTimersByTimeAsync(1000)
        await resultPromise.catch(() => {})
      }

      // Wait for reset timeout
      await vi.advanceTimersByTimeAsync(5000)

      // Service recovers
      shouldFail = false

      const result = await retry.execute(operation)

      expect(result.success).toBe(true)
    })
  })
})

describe('QuotaManager', () => {
  let quotaManager: QuotaManager

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('API quota tracking', () => {
    it('should track API quota usage', async () => {
      quotaManager = createQuotaManager({
        quotas: [
          { name: 'daily', limit: 1000, windowMs: 24 * 60 * 60 * 1000 },
          { name: 'hourly', limit: 100, windowMs: 60 * 60 * 1000 },
        ],
      })

      await quotaManager.consume('daily', 50)
      await quotaManager.consume('hourly', 10)

      const dailyStatus = await quotaManager.getStatus('daily')
      const hourlyStatus = await quotaManager.getStatus('hourly')

      expect(dailyStatus.used).toBe(50)
      expect(dailyStatus.remaining).toBe(950)
      expect(hourlyStatus.used).toBe(10)
      expect(hourlyStatus.remaining).toBe(90)
    })

    it('should reject when quota exceeded', async () => {
      quotaManager = createQuotaManager({
        quotas: [{ name: 'requests', limit: 10, windowMs: 60000 }],
      })

      await quotaManager.consume('requests', 10)

      await expect(quotaManager.consume('requests', 1)).rejects.toThrow(/quota.*exceeded/i)
    })

    it('should reset quota after window expires', async () => {
      quotaManager = createQuotaManager({
        quotas: [{ name: 'requests', limit: 10, windowMs: 60000 }],
      })

      await quotaManager.consume('requests', 10)

      // Advance past window
      vi.advanceTimersByTime(60001)

      // Should allow new requests
      await expect(quotaManager.consume('requests', 5)).resolves.not.toThrow()

      const status = await quotaManager.getStatus('requests')
      expect(status.used).toBe(5)
    })
  })

  describe('concurrent request limits', () => {
    it('should limit concurrent requests', async () => {
      quotaManager = createQuotaManager({
        maxConcurrent: 3,
      })

      const tasks: Promise<void>[] = []

      // Start 3 concurrent tasks
      for (let i = 0; i < 3; i++) {
        tasks.push(quotaManager.withConcurrencyLimit(async () => new Promise((r) => setTimeout(r, 1000))))
      }

      // 4th task should wait
      let fourthStarted = false
      const fourthTask = quotaManager.withConcurrencyLimit(async () => {
        fourthStarted = true
      })

      await vi.advanceTimersByTimeAsync(0)
      expect(fourthStarted).toBe(false)

      // Complete first task
      await vi.advanceTimersByTimeAsync(1000)

      // Now fourth should run
      await fourthTask
      expect(fourthStarted).toBe(true)
    })

    it('should track concurrent request count', async () => {
      quotaManager = createQuotaManager({ maxConcurrent: 5 })

      // Start 3 tasks
      const tasks = []
      for (let i = 0; i < 3; i++) {
        tasks.push(quotaManager.withConcurrencyLimit(async () => new Promise((r) => setTimeout(r, 1000))))
      }

      await vi.advanceTimersByTimeAsync(0)

      expect(quotaManager.getConcurrentCount()).toBe(3)

      await vi.advanceTimersByTimeAsync(1000)
      await Promise.all(tasks)

      expect(quotaManager.getConcurrentCount()).toBe(0)
    })
  })
})

describe('parseRateLimitHeaders', () => {
  it('should parse standard X-RateLimit headers', () => {
    const headers = new Headers({
      'X-RateLimit-Limit': '1000',
      'X-RateLimit-Remaining': '999',
      'X-RateLimit-Reset': '1705320000',
    })

    const info = parseRateLimitHeaders(headers)

    expect(info.limit).toBe(1000)
    expect(info.remaining).toBe(999)
    expect(info.resetAt).toEqual(new Date(1705320000 * 1000))
  })

  it('should parse RateLimit headers (draft standard)', () => {
    const headers = new Headers({
      RateLimit: 'limit=100, remaining=50, reset=30',
    })

    const info = parseRateLimitHeaders(headers)

    expect(info.limit).toBe(100)
    expect(info.remaining).toBe(50)
    // reset is in seconds from now
    expect(info.resetInSeconds).toBe(30)
  })

  it('should parse Retry-After header', () => {
    const headers = new Headers({
      'Retry-After': '120',
    })

    const info = parseRateLimitHeaders(headers)

    expect(info.retryAfterSeconds).toBe(120)
  })

  it('should parse GitHub-style rate limit headers', () => {
    const headers = new Headers({
      'X-RateLimit-Limit': '5000',
      'X-RateLimit-Remaining': '4999',
      'X-RateLimit-Reset': '1705320000',
      'X-RateLimit-Used': '1',
      'X-RateLimit-Resource': 'core',
    })

    const info = parseRateLimitHeaders(headers)

    expect(info.limit).toBe(5000)
    expect(info.used).toBe(1)
    expect(info.resource).toBe('core')
  })

  it('should handle missing headers gracefully', () => {
    const headers = new Headers()

    const info = parseRateLimitHeaders(headers)

    expect(info.limit).toBeUndefined()
    expect(info.remaining).toBeUndefined()
  })
})

// =============================================================================
// Schema Mapping Enhancement Tests (dotdo-0qyo3)
// =============================================================================

import {
  type SchemaMapper,
  type SchemaMapping,
  type SchemaEvolution,
  type SchemaVersion,
  type SchemaDiff,
  createSchemaMapper,
  detectSchemaChanges,
  createSchemaEvolutionHandler,
  type FieldAlias,
  type DefaultValue,
} from './schema-mapping'

describe('SchemaMapper', () => {
  describe('field renaming and aliasing', () => {
    it('should support multiple aliases for a field', () => {
      const mapper = createSchemaMapper({
        aliases: [
          { target: 'email', sources: ['email_address', 'emailAddress', 'e_mail'] },
          { target: 'phone', sources: ['phone_number', 'phoneNumber', 'tel'] },
        ],
      })

      // Should map any alias to the target field
      expect(mapper.apply({ email_address: 'test@example.com' })).toEqual({ email: 'test@example.com' })
      expect(mapper.apply({ emailAddress: 'test@example.com' })).toEqual({ email: 'test@example.com' })
      expect(mapper.apply({ e_mail: 'test@example.com' })).toEqual({ email: 'test@example.com' })
    })

    it('should preserve original field if it exists', () => {
      const mapper = createSchemaMapper({
        aliases: [{ target: 'email', sources: ['email_address'] }],
      })

      // If both exist, prefer the target name
      const result = mapper.apply({ email: 'primary@example.com', email_address: 'secondary@example.com' })
      expect(result.email).toBe('primary@example.com')
      expect(result).not.toHaveProperty('email_address')
    })

    it('should support bidirectional mapping', () => {
      const mapper = createSchemaMapper({
        aliases: [{ target: 'email', sources: ['email_address'], bidirectional: true }],
      })

      // Forward: source -> target
      expect(mapper.apply({ email_address: 'test@example.com' })).toEqual({ email: 'test@example.com' })

      // Reverse: target -> source
      expect(mapper.reverse({ email: 'test@example.com' })).toEqual({ email_address: 'test@example.com' })
    })
  })

  describe('type coercion rules', () => {
    it('should handle edge cases for number coercion', () => {
      const mapper = createSchemaMapper({
        coercions: [
          { field: 'amount', targetType: 'number' },
          { field: 'quantity', targetType: 'integer' },
        ],
      })

      expect(mapper.apply({ amount: '99.99' }).amount).toBe(99.99)
      expect(mapper.apply({ amount: '' }).amount).toBe(0) // Empty string -> 0
      expect(mapper.apply({ amount: null }).amount).toBeNull() // Null preserved
      expect(mapper.apply({ amount: 'invalid' }).amount).toBeNaN() // Invalid -> NaN
      expect(mapper.apply({ quantity: '5.7' }).quantity).toBe(5) // Float -> integer
    })

    it('should handle array type coercion', () => {
      const mapper = createSchemaMapper({
        coercions: [{ field: 'tags', targetType: 'array', delimiter: ',' }],
      })

      expect(mapper.apply({ tags: 'a,b,c' }).tags).toEqual(['a', 'b', 'c'])
      expect(mapper.apply({ tags: ['a', 'b'] }).tags).toEqual(['a', 'b']) // Already array
      expect(mapper.apply({ tags: 'single' }).tags).toEqual(['single'])
    })

    it('should handle object type coercion from JSON string', () => {
      const mapper = createSchemaMapper({
        coercions: [{ field: 'metadata', targetType: 'object' }],
      })

      const jsonStr = '{"key": "value"}'
      expect(mapper.apply({ metadata: jsonStr }).metadata).toEqual({ key: 'value' })
    })

    it('should support custom coercion functions', () => {
      const mapper = createSchemaMapper({
        coercions: [
          {
            field: 'status',
            targetType: 'custom',
            coerce: (value) => {
              const statusMap: Record<string, string> = { '1': 'active', '0': 'inactive', true: 'active', false: 'inactive' }
              return statusMap[String(value)] ?? 'unknown'
            },
          },
        ],
      })

      expect(mapper.apply({ status: 1 }).status).toBe('active')
      expect(mapper.apply({ status: '0' }).status).toBe('inactive')
      expect(mapper.apply({ status: true }).status).toBe('active')
    })
  })

  describe('nested field flattening', () => {
    it('should flatten deeply nested objects', () => {
      const mapper = createSchemaMapper({
        flatten: { depth: 3, separator: '.' },
      })

      const input = {
        user: {
          profile: {
            address: {
              street: '123 Main',
              city: 'NYC',
            },
          },
        },
      }

      const output = mapper.apply(input)

      expect(output['user.profile.address.street']).toBe('123 Main')
      expect(output['user.profile.address.city']).toBe('NYC')
    })

    it('should respect max depth for flattening', () => {
      const mapper = createSchemaMapper({
        flatten: { depth: 1, separator: '_' },
      })

      const input = {
        a: {
          b: {
            c: 'value',
          },
        },
      }

      const output = mapper.apply(input)

      // Only flatten 1 level deep
      expect(output['a_b']).toEqual({ c: 'value' })
      expect(output).not.toHaveProperty('a_b_c')
    })

    it('should handle arrays during flattening', () => {
      const mapper = createSchemaMapper({
        flatten: { depth: 2, separator: '.', flattenArrays: true },
      })

      const input = {
        items: [
          { name: 'a', price: 10 },
          { name: 'b', price: 20 },
        ],
      }

      const output = mapper.apply(input)

      expect(output['items.0.name']).toBe('a')
      expect(output['items.1.price']).toBe(20)
    })

    it('should support selective flattening of specific paths', () => {
      const mapper = createSchemaMapper({
        flatten: {
          paths: ['metadata', 'config'],
          separator: '_',
        },
      })

      const input = {
        id: 1,
        metadata: { version: 1, tags: ['a'] },
        config: { enabled: true },
        nested: { keep: 'as-is' },
      }

      const output = mapper.apply(input)

      expect(output.id).toBe(1)
      expect(output.metadata_version).toBe(1)
      expect(output.config_enabled).toBe(true)
      expect(output.nested).toEqual({ keep: 'as-is' })
    })
  })

  describe('computed/derived fields', () => {
    it('should support async computed fields', async () => {
      const mapper = createSchemaMapper({
        computed: [
          {
            name: 'enrichedData',
            expression: async (record) => {
              // Simulate async lookup
              await new Promise((r) => setTimeout(r, 10))
              return { enriched: true, originalId: record.id }
            },
          },
        ],
      })

      const result = await mapper.applyAsync({ id: 123 })

      expect(result.enrichedData).toEqual({ enriched: true, originalId: 123 })
    })

    it('should support computed fields with dependencies', () => {
      const mapper = createSchemaMapper({
        computed: [
          {
            name: 'subtotal',
            expression: (r) => (r.price as number) * (r.quantity as number),
          },
          {
            name: 'tax',
            expression: (r) => (r.subtotal as number) * 0.1,
            dependsOn: ['subtotal'],
          },
          {
            name: 'total',
            expression: (r) => (r.subtotal as number) + (r.tax as number),
            dependsOn: ['subtotal', 'tax'],
          },
        ],
      })

      const result = mapper.apply({ price: 100, quantity: 2 })

      expect(result.subtotal).toBe(200)
      expect(result.tax).toBe(20)
      expect(result.total).toBe(220)
    })

    it('should detect circular dependencies in computed fields', () => {
      expect(() =>
        createSchemaMapper({
          computed: [
            { name: 'a', expression: (r) => r.b, dependsOn: ['b'] },
            { name: 'b', expression: (r) => r.a, dependsOn: ['a'] },
          ],
        }),
      ).toThrow(/circular/i)
    })
  })

  describe('default values', () => {
    it('should apply default values for missing fields', () => {
      const mapper = createSchemaMapper({
        defaults: [
          { field: 'status', value: 'pending' },
          { field: 'count', value: 0 },
          { field: 'tags', value: [] },
        ],
      })

      const result = mapper.apply({ name: 'test' })

      expect(result.status).toBe('pending')
      expect(result.count).toBe(0)
      expect(result.tags).toEqual([])
    })

    it('should support factory functions for defaults', () => {
      const mapper = createSchemaMapper({
        defaults: [
          { field: 'id', factory: () => crypto.randomUUID() },
          { field: 'createdAt', factory: () => new Date().toISOString() },
        ],
      })

      const result1 = mapper.apply({})
      const result2 = mapper.apply({})

      expect(result1.id).not.toBe(result2.id) // Different IDs
      expect(typeof result1.createdAt).toBe('string')
    })

    it('should not overwrite existing values with defaults', () => {
      const mapper = createSchemaMapper({
        defaults: [{ field: 'status', value: 'pending' }],
      })

      const result = mapper.apply({ status: 'active' })

      expect(result.status).toBe('active')
    })
  })
})

describe('SchemaEvolution', () => {
  describe('detecting schema changes', () => {
    it('should detect added fields', () => {
      const oldSchema = {
        type: 'object' as const,
        properties: {
          id: { type: 'integer' as const },
          name: { type: 'string' as const },
        },
      }

      const newSchema = {
        type: 'object' as const,
        properties: {
          id: { type: 'integer' as const },
          name: { type: 'string' as const },
          email: { type: 'string' as const },
        },
      }

      const diff = detectSchemaChanges(oldSchema, newSchema)

      expect(diff.added).toContain('email')
      expect(diff.removed).toHaveLength(0)
      expect(diff.modified).toHaveLength(0)
    })

    it('should detect removed fields', () => {
      const oldSchema = {
        type: 'object' as const,
        properties: {
          id: { type: 'integer' as const },
          name: { type: 'string' as const },
          deprecated: { type: 'string' as const },
        },
      }

      const newSchema = {
        type: 'object' as const,
        properties: {
          id: { type: 'integer' as const },
          name: { type: 'string' as const },
        },
      }

      const diff = detectSchemaChanges(oldSchema, newSchema)

      expect(diff.removed).toContain('deprecated')
    })

    it('should detect type changes', () => {
      const oldSchema = {
        type: 'object' as const,
        properties: {
          count: { type: 'string' as const },
        },
      }

      const newSchema = {
        type: 'object' as const,
        properties: {
          count: { type: 'integer' as const },
        },
      }

      const diff = detectSchemaChanges(oldSchema, newSchema)

      expect(diff.modified).toContainEqual({
        field: 'count',
        oldType: 'string',
        newType: 'integer',
      })
    })

    it('should classify changes as breaking or non-breaking', () => {
      const oldSchema = {
        type: 'object' as const,
        properties: {
          id: { type: 'integer' as const },
          status: { type: 'string' as const },
        },
      }

      const newSchema = {
        type: 'object' as const,
        properties: {
          id: { type: 'string' as const }, // Type change - breaking
          status: { type: 'string' as const },
          newField: { type: 'string' as const }, // Added - non-breaking
        },
      }

      const diff = detectSchemaChanges(oldSchema, newSchema)

      expect(diff.breaking).toContain('id')
      expect(diff.nonBreaking).toContain('newField')
    })
  })

  describe('handling schema evolution', () => {
    it('should auto-migrate compatible changes', () => {
      const handler = createSchemaEvolutionHandler({
        strategy: 'auto',
      })

      const oldSchema = {
        type: 'object' as const,
        properties: { id: { type: 'integer' as const } },
      }

      const newSchema = {
        type: 'object' as const,
        properties: {
          id: { type: 'integer' as const },
          email: { type: 'string' as const },
        },
      }

      const mapper = handler.evolve(oldSchema, newSchema)
      const result = mapper.apply({ id: 1 })

      expect(result.id).toBe(1)
      expect(result).not.toHaveProperty('email') // New field, no default
    })

    it('should apply defaults for new required fields', () => {
      const handler = createSchemaEvolutionHandler({
        strategy: 'auto',
        defaults: {
          email: 'unknown@example.com',
        },
      })

      const oldSchema = {
        type: 'object' as const,
        properties: { id: { type: 'integer' as const } },
      }

      const newSchema = {
        type: 'object' as const,
        properties: {
          id: { type: 'integer' as const },
          email: { type: 'string' as const },
        },
        required: ['id', 'email'],
      }

      const mapper = handler.evolve(oldSchema, newSchema)
      const result = mapper.apply({ id: 1 })

      expect(result.email).toBe('unknown@example.com')
    })

    it('should reject breaking changes in strict mode', () => {
      const handler = createSchemaEvolutionHandler({
        strategy: 'strict',
      })

      const oldSchema = {
        type: 'object' as const,
        properties: { id: { type: 'integer' as const } },
      }

      const newSchema = {
        type: 'object' as const,
        properties: { id: { type: 'string' as const } },
      }

      expect(() => handler.evolve(oldSchema, newSchema)).toThrow(/breaking/i)
    })

    it('should apply custom migration for breaking changes', () => {
      const handler = createSchemaEvolutionHandler({
        strategy: 'custom',
        migrations: {
          id: {
            from: 'integer',
            to: 'string',
            migrate: (value) => String(value),
          },
        },
      })

      const oldSchema = {
        type: 'object' as const,
        properties: { id: { type: 'integer' as const } },
      }

      const newSchema = {
        type: 'object' as const,
        properties: { id: { type: 'string' as const } },
      }

      const mapper = handler.evolve(oldSchema, newSchema)
      const result = mapper.apply({ id: 123 })

      expect(result.id).toBe('123')
    })
  })

  describe('version tracking', () => {
    it('should track schema versions', () => {
      const handler = createSchemaEvolutionHandler({
        strategy: 'auto',
        versionTracking: true,
      })

      const v1Schema = {
        type: 'object' as const,
        properties: { id: { type: 'integer' as const } },
      }

      const v2Schema = {
        type: 'object' as const,
        properties: {
          id: { type: 'integer' as const },
          name: { type: 'string' as const },
        },
      }

      handler.registerVersion('1.0.0', v1Schema)
      handler.registerVersion('2.0.0', v2Schema)

      const mapper = handler.getMapperForVersion('1.0.0', '2.0.0')

      expect(mapper).toBeDefined()
    })

    it('should provide migration path between versions', () => {
      const handler = createSchemaEvolutionHandler({
        strategy: 'auto',
        versionTracking: true,
      })

      const v1 = { type: 'object' as const, properties: { a: { type: 'string' as const } } }
      const v2 = {
        type: 'object' as const,
        properties: {
          a: { type: 'string' as const },
          b: { type: 'string' as const },
        },
      }
      const v3 = {
        type: 'object' as const,
        properties: {
          a: { type: 'string' as const },
          b: { type: 'string' as const },
          c: { type: 'string' as const },
        },
      }

      handler.registerVersion('1.0.0', v1)
      handler.registerVersion('2.0.0', v2)
      handler.registerVersion('3.0.0', v3)

      const path = handler.getMigrationPath('1.0.0', '3.0.0')

      expect(path).toEqual(['1.0.0', '2.0.0', '3.0.0'])
    })
  })
})
