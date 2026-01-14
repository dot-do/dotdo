/**
 * DeliveryQueue Tests - TDD for notification delivery queue
 *
 * Tests the DeliveryQueue which provides:
 * - Batching of deliveries
 * - Per-channel rate limiting
 * - Retry logic with exponential backoff and jitter
 * - Dead letter queue (DLQ) for failed deliveries
 * - Delivery status tracking
 * - Persistence via Durable Objects (storage interface)
 *
 * @module db/primitives/notifications/tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createDeliveryQueue,
  DeliveryQueue,
  type DeliveryQueueOptions,
  type DeliveryItem,
  type DeliveryResult,
  type DeliveryHandler,
  type DeadLetterEntry,
  type RateLimitConfig,
  type RetryConfig,
  type BatchConfig,
  type QueueStats,
  type QueueStorage,
} from '../delivery-queue'

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Creates a mock storage implementation for testing
 */
function createMockStorage(): QueueStorage {
  const items = new Map<string, unknown>()

  return {
    async get<T>(key: string): Promise<T | undefined> {
      return items.get(key) as T | undefined
    },
    async put<T>(key: string, value: T): Promise<void> {
      items.set(key, value)
    },
    async delete(key: string): Promise<boolean> {
      return items.delete(key)
    },
    async list<T>(prefix: string): Promise<Map<string, T>> {
      const result = new Map<string, T>()
      for (const [key, value] of items) {
        if (key.startsWith(prefix)) {
          result.set(key, value as T)
        }
      }
      return result
    },
  }
}

/**
 * Creates a mock delivery handler
 */
function createMockHandler(
  options: {
    delay?: number
    failUntilAttempt?: number
    failWithError?: Error
    retryable?: boolean
  } = {}
): DeliveryHandler {
  let attemptCount = 0

  return vi.fn(async (item: DeliveryItem) => {
    attemptCount++

    if (options.delay) {
      await new Promise((resolve) => setTimeout(resolve, options.delay))
    }

    if (options.failUntilAttempt && attemptCount < options.failUntilAttempt) {
      const error = options.failWithError ?? new Error('Delivery failed')
      if (options.retryable !== undefined) {
        ;(error as Error & { retryable?: boolean }).retryable = options.retryable
      }
      throw error
    }

    return { messageId: `msg_${item.id}_${attemptCount}` }
  })
}

// =============================================================================
// Factory and Constructor Tests
// =============================================================================

describe('DeliveryQueue Factory', () => {
  describe('createDeliveryQueue()', () => {
    it('creates a DeliveryQueue instance', () => {
      const storage = createMockStorage()
      const queue = createDeliveryQueue({ storage })

      expect(queue).toBeDefined()
      expect(queue).toBeInstanceOf(DeliveryQueue)
    })

    it('accepts storage configuration', () => {
      const storage = createMockStorage()
      const queue = createDeliveryQueue({ storage })

      expect(queue).toBeDefined()
    })

    it('accepts retry configuration', () => {
      const storage = createMockStorage()
      const queue = createDeliveryQueue({
        storage,
        retry: {
          maxAttempts: 5,
          initialDelayMs: 500,
          maxDelayMs: 30000,
          backoffMultiplier: 2,
          jitterFactor: 0.2,
        },
      })

      expect(queue).toBeDefined()
    })

    it('accepts batch configuration', () => {
      const storage = createMockStorage()
      const queue = createDeliveryQueue({
        storage,
        batch: {
          maxSize: 100,
          maxWaitMs: 5000,
        },
      })

      expect(queue).toBeDefined()
    })

    it('accepts rate limit configuration', () => {
      const storage = createMockStorage()
      const queue = createDeliveryQueue({
        storage,
        rateLimit: {
          email: { maxPerSecond: 10, maxPerMinute: 100 },
          sms: { maxPerSecond: 5, maxPerMinute: 50 },
        },
      })

      expect(queue).toBeDefined()
    })
  })
})

// =============================================================================
// Enqueueing Tests
// =============================================================================

describe('Enqueueing Deliveries', () => {
  let queue: DeliveryQueue
  let storage: QueueStorage

  beforeEach(() => {
    storage = createMockStorage()
    queue = createDeliveryQueue({ storage })
  })

  describe('enqueue()', () => {
    it('enqueues a single delivery item', async () => {
      const result = await queue.enqueue({
        channel: 'email',
        payload: { to: 'user@example.com', subject: 'Test', body: 'Hello' },
        recipient: { email: 'user@example.com' },
      })

      expect(result.id).toBeDefined()
      expect(result.status).toBe('queued')
    })

    it('assigns unique IDs to each item', async () => {
      const result1 = await queue.enqueue({
        channel: 'email',
        payload: { subject: 'Test 1' },
        recipient: { email: 'user1@example.com' },
      })

      const result2 = await queue.enqueue({
        channel: 'email',
        payload: { subject: 'Test 2' },
        recipient: { email: 'user2@example.com' },
      })

      expect(result1.id).not.toBe(result2.id)
    })

    it('persists items to storage', async () => {
      const result = await queue.enqueue({
        channel: 'email',
        payload: { subject: 'Test' },
        recipient: { email: 'user@example.com' },
      })

      const stored = await storage.get<DeliveryItem>(`delivery:${result.id}`)
      expect(stored).toBeDefined()
      expect(stored?.channel).toBe('email')
    })

    it('supports priority levels', async () => {
      const result = await queue.enqueue({
        channel: 'email',
        payload: { subject: 'Urgent' },
        recipient: { email: 'user@example.com' },
        priority: 'high',
      })

      expect(result.status).toBe('queued')
    })

    it('supports scheduled delivery', async () => {
      const scheduledAt = new Date(Date.now() + 60000)
      const result = await queue.enqueue({
        channel: 'email',
        payload: { subject: 'Scheduled' },
        recipient: { email: 'user@example.com' },
        scheduledAt,
      })

      expect(result.status).toBe('scheduled')
    })

    it('supports metadata', async () => {
      const result = await queue.enqueue({
        channel: 'email',
        payload: { subject: 'Test' },
        recipient: { email: 'user@example.com' },
        metadata: { orderId: 'order_123', source: 'checkout' },
      })

      const stored = await storage.get<DeliveryItem>(`delivery:${result.id}`)
      expect(stored?.metadata).toEqual({ orderId: 'order_123', source: 'checkout' })
    })
  })

  describe('enqueueBatch()', () => {
    it('enqueues multiple items at once', async () => {
      const results = await queue.enqueueBatch([
        { channel: 'email', payload: { subject: 'Test 1' }, recipient: { email: 'user1@example.com' } },
        { channel: 'email', payload: { subject: 'Test 2' }, recipient: { email: 'user2@example.com' } },
        { channel: 'sms', payload: { body: 'Test SMS' }, recipient: { phone: '+1234567890' } },
      ])

      expect(results).toHaveLength(3)
      expect(results.every((r) => r.status === 'queued')).toBe(true)
    })

    it('atomically enqueues all items', async () => {
      // All items should be persisted or none
      const results = await queue.enqueueBatch([
        { channel: 'email', payload: { subject: 'Test 1' }, recipient: { email: 'user1@example.com' } },
        { channel: 'email', payload: { subject: 'Test 2' }, recipient: { email: 'user2@example.com' } },
      ])

      const items = await storage.list<DeliveryItem>('delivery:')
      expect(items.size).toBe(2)
    })
  })
})

// =============================================================================
// Processing Tests
// =============================================================================

describe('Processing Deliveries', () => {
  let queue: DeliveryQueue
  let storage: QueueStorage
  let handler: DeliveryHandler

  beforeEach(() => {
    vi.useFakeTimers()
    storage = createMockStorage()
    handler = createMockHandler()
    queue = createDeliveryQueue({ storage })
    queue.registerHandler('email', handler)
  })

  afterEach(() => {
    vi.useRealTimers()
    queue.stop()
  })

  describe('registerHandler()', () => {
    it('registers a handler for a channel', () => {
      const smsHandler = createMockHandler()
      queue.registerHandler('sms', smsHandler)

      // Handler should be registered
      expect(queue.hasHandler('sms')).toBe(true)
    })

    it('replaces existing handler for same channel', () => {
      const newHandler = createMockHandler()
      queue.registerHandler('email', newHandler)

      expect(queue.hasHandler('email')).toBe(true)
    })
  })

  describe('process()', () => {
    it('processes a single item', async () => {
      const result = await queue.enqueue({
        channel: 'email',
        payload: { subject: 'Test' },
        recipient: { email: 'user@example.com' },
      })

      await queue.processOne(result.id)

      expect(handler).toHaveBeenCalledOnce()
    })

    it('updates item status to sent on success', async () => {
      const result = await queue.enqueue({
        channel: 'email',
        payload: { subject: 'Test' },
        recipient: { email: 'user@example.com' },
      })

      await queue.processOne(result.id)

      const status = await queue.getStatus(result.id)
      expect(status?.status).toBe('sent')
    })

    it('records messageId from handler', async () => {
      const result = await queue.enqueue({
        channel: 'email',
        payload: { subject: 'Test' },
        recipient: { email: 'user@example.com' },
      })

      await queue.processOne(result.id)

      const status = await queue.getStatus(result.id)
      expect(status?.messageId).toBeDefined()
    })

    it('records sentAt timestamp', async () => {
      const result = await queue.enqueue({
        channel: 'email',
        payload: { subject: 'Test' },
        recipient: { email: 'user@example.com' },
      })

      await queue.processOne(result.id)

      const status = await queue.getStatus(result.id)
      expect(status?.sentAt).toBeDefined()
    })
  })

  describe('processBatch()', () => {
    it('processes multiple items in batch', async () => {
      const results = await queue.enqueueBatch([
        { channel: 'email', payload: { subject: 'Test 1' }, recipient: { email: 'user1@example.com' } },
        { channel: 'email', payload: { subject: 'Test 2' }, recipient: { email: 'user2@example.com' } },
      ])

      await queue.processBatch(results.map((r) => r.id))

      expect(handler).toHaveBeenCalledTimes(2)
    })

    it('continues processing on partial failure', async () => {
      const failingHandler = createMockHandler({ failUntilAttempt: 999 })
      const successHandler = createMockHandler()

      queue.registerHandler('email', successHandler)
      queue.registerHandler('sms', failingHandler)

      const results = await queue.enqueueBatch([
        { channel: 'email', payload: { subject: 'Test' }, recipient: { email: 'user@example.com' } },
        { channel: 'sms', payload: { body: 'Test' }, recipient: { phone: '+1234567890' } },
      ])

      await queue.processBatch(results.map((r) => r.id))

      expect(successHandler).toHaveBeenCalledOnce()
      expect(failingHandler).toHaveBeenCalledOnce()
    })
  })
})

// =============================================================================
// Retry Logic Tests
// =============================================================================

describe('Retry Logic with Exponential Backoff', () => {
  let queue: DeliveryQueue
  let storage: QueueStorage

  beforeEach(() => {
    vi.useFakeTimers()
    storage = createMockStorage()
  })

  afterEach(() => {
    vi.useRealTimers()
    queue?.stop()
  })

  describe('Exponential backoff', () => {
    it('retries failed deliveries', async () => {
      const handler = createMockHandler({ failUntilAttempt: 3 })
      queue = createDeliveryQueue({
        storage,
        retry: { maxAttempts: 5, initialDelayMs: 1000, backoffMultiplier: 2, jitterFactor: 0 },
      })
      queue.registerHandler('email', handler)

      const result = await queue.enqueue({
        channel: 'email',
        payload: { subject: 'Test' },
        recipient: { email: 'user@example.com' },
      })

      // First attempt fails
      await queue.processOne(result.id)
      expect(handler).toHaveBeenCalledTimes(1)

      // Advance time for first retry (1000ms)
      await vi.advanceTimersByTimeAsync(1000)
      await queue.processRetries()
      expect(handler).toHaveBeenCalledTimes(2)

      // Advance time for second retry (2000ms with backoff)
      await vi.advanceTimersByTimeAsync(2000)
      await queue.processRetries()
      expect(handler).toHaveBeenCalledTimes(3)

      // Should succeed on third attempt
      const status = await queue.getStatus(result.id)
      expect(status?.status).toBe('sent')
    })

    it('uses exponential backoff for retry delays', async () => {
      const handler = createMockHandler({ failUntilAttempt: 4 })
      queue = createDeliveryQueue({
        storage,
        retry: { maxAttempts: 5, initialDelayMs: 1000, backoffMultiplier: 2, jitterFactor: 0 },
      })
      queue.registerHandler('email', handler)

      const result = await queue.enqueue({
        channel: 'email',
        payload: { subject: 'Test' },
        recipient: { email: 'user@example.com' },
      })

      await queue.processOne(result.id) // Attempt 1 fails

      const status1 = await queue.getStatus(result.id)
      expect(status1?.nextRetryAt).toBeDefined()

      // First retry should be ~1000ms
      const delay1 = status1!.nextRetryAt!.getTime() - Date.now()
      expect(delay1).toBeGreaterThanOrEqual(950)
      expect(delay1).toBeLessThanOrEqual(1050)

      await vi.advanceTimersByTimeAsync(1000)
      await queue.processRetries() // Attempt 2 fails

      const status2 = await queue.getStatus(result.id)
      // Second retry should be ~2000ms
      const delay2 = status2!.nextRetryAt!.getTime() - Date.now()
      expect(delay2).toBeGreaterThanOrEqual(1950)
      expect(delay2).toBeLessThanOrEqual(2050)

      await vi.advanceTimersByTimeAsync(2000)
      await queue.processRetries() // Attempt 3 fails

      const status3 = await queue.getStatus(result.id)
      // Third retry should be ~4000ms
      const delay3 = status3!.nextRetryAt!.getTime() - Date.now()
      expect(delay3).toBeGreaterThanOrEqual(3950)
      expect(delay3).toBeLessThanOrEqual(4050)
    })

    it('adds jitter to retry delays', async () => {
      const handler = createMockHandler({ failUntilAttempt: 999 })
      queue = createDeliveryQueue({
        storage,
        retry: { maxAttempts: 5, initialDelayMs: 1000, backoffMultiplier: 2, jitterFactor: 0.2 },
      })
      queue.registerHandler('email', handler)

      // Enqueue multiple items and check their retry times vary
      const delays: number[] = []

      for (let i = 0; i < 10; i++) {
        const result = await queue.enqueue({
          channel: 'email',
          payload: { subject: `Test ${i}` },
          recipient: { email: `user${i}@example.com` },
        })

        await queue.processOne(result.id)

        const status = await queue.getStatus(result.id)
        if (status?.nextRetryAt) {
          delays.push(status.nextRetryAt.getTime() - Date.now())
        }
      }

      // With 20% jitter, delays should vary between 800-1200ms
      const uniqueDelays = new Set(delays)
      // We expect some variation due to jitter
      expect(uniqueDelays.size).toBeGreaterThan(1)

      // All delays should be within jitter range
      for (const delay of delays) {
        expect(delay).toBeGreaterThanOrEqual(800)
        expect(delay).toBeLessThanOrEqual(1200)
      }
    })

    it('respects maxDelayMs cap', async () => {
      const handler = createMockHandler({ failUntilAttempt: 999 })
      queue = createDeliveryQueue({
        storage,
        retry: {
          maxAttempts: 10,
          initialDelayMs: 1000,
          backoffMultiplier: 10,
          maxDelayMs: 5000,
          jitterFactor: 0,
        },
      })
      queue.registerHandler('email', handler)

      const result = await queue.enqueue({
        channel: 'email',
        payload: { subject: 'Test' },
        recipient: { email: 'user@example.com' },
      })

      // Process multiple attempts to trigger cap
      for (let i = 0; i < 5; i++) {
        if (i === 0) {
          await queue.processOne(result.id)
        } else {
          await vi.advanceTimersByTimeAsync(5000)
          await queue.processRetries()
        }

        const status = await queue.getStatus(result.id)
        if (status?.nextRetryAt) {
          const delay = status.nextRetryAt.getTime() - Date.now()
          expect(delay).toBeLessThanOrEqual(5100) // 5000 + tolerance
        }
      }
    })

    it('stops retrying after maxAttempts', async () => {
      const handler = createMockHandler({ failUntilAttempt: 999 })
      queue = createDeliveryQueue({
        storage,
        retry: { maxAttempts: 3, initialDelayMs: 100, backoffMultiplier: 2, jitterFactor: 0 },
      })
      queue.registerHandler('email', handler)

      const result = await queue.enqueue({
        channel: 'email',
        payload: { subject: 'Test' },
        recipient: { email: 'user@example.com' },
      })

      // Process all attempts
      await queue.processOne(result.id) // Attempt 1

      await vi.advanceTimersByTimeAsync(100)
      await queue.processRetries() // Attempt 2

      await vi.advanceTimersByTimeAsync(200)
      await queue.processRetries() // Attempt 3

      // Should have exhausted retries
      const status = await queue.getStatus(result.id)
      expect(status?.status).toBe('failed')
      expect(status?.attempts).toBe(3)
      expect(handler).toHaveBeenCalledTimes(3)
    })

    it('does not retry non-retryable errors', async () => {
      const nonRetryableError = new Error('Invalid recipient')
      ;(nonRetryableError as Error & { retryable?: boolean }).retryable = false

      const handler = createMockHandler({ failUntilAttempt: 999, failWithError: nonRetryableError, retryable: false })
      queue = createDeliveryQueue({
        storage,
        retry: { maxAttempts: 5, initialDelayMs: 100, backoffMultiplier: 2 },
      })
      queue.registerHandler('email', handler)

      const result = await queue.enqueue({
        channel: 'email',
        payload: { subject: 'Test' },
        recipient: { email: 'invalid' },
      })

      await queue.processOne(result.id)

      // Should NOT retry
      const status = await queue.getStatus(result.id)
      expect(status?.status).toBe('failed')
      expect(status?.attempts).toBe(1)
      expect(handler).toHaveBeenCalledTimes(1)
    })
  })

  describe('Retry tracking', () => {
    it('tracks attempt count', async () => {
      const handler = createMockHandler({ failUntilAttempt: 3 })
      queue = createDeliveryQueue({
        storage,
        retry: { maxAttempts: 5, initialDelayMs: 100, backoffMultiplier: 2, jitterFactor: 0 },
      })
      queue.registerHandler('email', handler)

      const result = await queue.enqueue({
        channel: 'email',
        payload: { subject: 'Test' },
        recipient: { email: 'user@example.com' },
      })

      await queue.processOne(result.id)
      expect((await queue.getStatus(result.id))?.attempts).toBe(1)

      await vi.advanceTimersByTimeAsync(100)
      await queue.processRetries()
      expect((await queue.getStatus(result.id))?.attempts).toBe(2)

      await vi.advanceTimersByTimeAsync(200)
      await queue.processRetries()
      expect((await queue.getStatus(result.id))?.attempts).toBe(3)
    })

    it('tracks last error', async () => {
      const handler = createMockHandler({ failUntilAttempt: 3, failWithError: new Error('Service unavailable') })
      queue = createDeliveryQueue({
        storage,
        retry: { maxAttempts: 5, initialDelayMs: 100, backoffMultiplier: 2 },
      })
      queue.registerHandler('email', handler)

      const result = await queue.enqueue({
        channel: 'email',
        payload: { subject: 'Test' },
        recipient: { email: 'user@example.com' },
      })

      await queue.processOne(result.id)

      const status = await queue.getStatus(result.id)
      expect(status?.lastError).toBe('Service unavailable')
    })
  })
})

// =============================================================================
// Rate Limiting Tests
// =============================================================================

describe('Per-Channel Rate Limiting', () => {
  let queue: DeliveryQueue
  let storage: QueueStorage

  beforeEach(() => {
    vi.useFakeTimers()
    storage = createMockStorage()
  })

  afterEach(() => {
    vi.useRealTimers()
    queue?.stop()
  })

  describe('Rate limit enforcement', () => {
    it('enforces per-channel rate limits', async () => {
      const handler = createMockHandler()
      queue = createDeliveryQueue({
        storage,
        rateLimit: {
          email: { maxPerSecond: 2, maxPerMinute: 10 },
        },
      })
      queue.registerHandler('email', handler)

      // Enqueue 5 items
      const results = await queue.enqueueBatch([
        { channel: 'email', payload: { subject: 'Test 1' }, recipient: { email: 'user1@example.com' } },
        { channel: 'email', payload: { subject: 'Test 2' }, recipient: { email: 'user2@example.com' } },
        { channel: 'email', payload: { subject: 'Test 3' }, recipient: { email: 'user3@example.com' } },
        { channel: 'email', payload: { subject: 'Test 4' }, recipient: { email: 'user4@example.com' } },
        { channel: 'email', payload: { subject: 'Test 5' }, recipient: { email: 'user5@example.com' } },
      ])

      // Process all
      await queue.processBatch(results.map((r) => r.id))

      // Only 2 should have been processed (rate limit)
      expect(handler).toHaveBeenCalledTimes(2)
    })

    it('allows different channels at different rates', async () => {
      const emailHandler = createMockHandler()
      const smsHandler = createMockHandler()

      queue = createDeliveryQueue({
        storage,
        rateLimit: {
          email: { maxPerSecond: 3 },
          sms: { maxPerSecond: 1 },
        },
      })
      queue.registerHandler('email', emailHandler)
      queue.registerHandler('sms', smsHandler)

      const results = await queue.enqueueBatch([
        { channel: 'email', payload: { subject: 'Email 1' }, recipient: { email: 'user1@example.com' } },
        { channel: 'email', payload: { subject: 'Email 2' }, recipient: { email: 'user2@example.com' } },
        { channel: 'email', payload: { subject: 'Email 3' }, recipient: { email: 'user3@example.com' } },
        { channel: 'sms', payload: { body: 'SMS 1' }, recipient: { phone: '+1111111111' } },
        { channel: 'sms', payload: { body: 'SMS 2' }, recipient: { phone: '+2222222222' } },
      ])

      await queue.processBatch(results.map((r) => r.id))

      // Email: 3 allowed, SMS: 1 allowed
      expect(emailHandler).toHaveBeenCalledTimes(3)
      expect(smsHandler).toHaveBeenCalledTimes(1)
    })

    it('resets rate limit after window expires', async () => {
      const handler = createMockHandler()
      queue = createDeliveryQueue({
        storage,
        rateLimit: {
          email: { maxPerSecond: 2 },
        },
      })
      queue.registerHandler('email', handler)

      // First batch
      const batch1 = await queue.enqueueBatch([
        { channel: 'email', payload: { subject: 'Test 1' }, recipient: { email: 'user1@example.com' } },
        { channel: 'email', payload: { subject: 'Test 2' }, recipient: { email: 'user2@example.com' } },
        { channel: 'email', payload: { subject: 'Test 3' }, recipient: { email: 'user3@example.com' } },
      ])

      await queue.processBatch(batch1.map((r) => r.id))
      expect(handler).toHaveBeenCalledTimes(2) // Only 2 due to rate limit

      // Advance time by 1 second
      await vi.advanceTimersByTimeAsync(1000)

      // Process remaining
      await queue.processPending()
      expect(handler).toHaveBeenCalledTimes(3) // Now 3rd one can process
    })

    it('returns rate-limited status for blocked items', async () => {
      const handler = createMockHandler()
      queue = createDeliveryQueue({
        storage,
        rateLimit: {
          email: { maxPerSecond: 1 },
        },
      })
      queue.registerHandler('email', handler)

      const results = await queue.enqueueBatch([
        { channel: 'email', payload: { subject: 'Test 1' }, recipient: { email: 'user1@example.com' } },
        { channel: 'email', payload: { subject: 'Test 2' }, recipient: { email: 'user2@example.com' } },
      ])

      await queue.processBatch(results.map((r) => r.id))

      // First should be sent, second should be rate-limited (still queued)
      const status1 = await queue.getStatus(results[0].id)
      const status2 = await queue.getStatus(results[1].id)

      expect(status1?.status).toBe('sent')
      expect(status2?.status).toBe('rate_limited')
    })
  })

  describe('Rate limit status', () => {
    it('returns current rate limit status', async () => {
      const handler = createMockHandler()
      queue = createDeliveryQueue({
        storage,
        rateLimit: {
          email: { maxPerSecond: 10, maxPerMinute: 100 },
        },
      })
      queue.registerHandler('email', handler)

      // Send 5 emails
      const results = await queue.enqueueBatch(
        Array.from({ length: 5 }, (_, i) => ({
          channel: 'email' as const,
          payload: { subject: `Test ${i}` },
          recipient: { email: `user${i}@example.com` },
        }))
      )

      await queue.processBatch(results.map((r) => r.id))

      const rateLimitStatus = queue.getRateLimitStatus('email')

      expect(rateLimitStatus.currentSecond).toBe(5)
      expect(rateLimitStatus.remainingSecond).toBe(5)
      expect(rateLimitStatus.currentMinute).toBe(5)
      expect(rateLimitStatus.remainingMinute).toBe(95)
    })
  })
})

// =============================================================================
// Batching Tests
// =============================================================================

describe('Batching', () => {
  let queue: DeliveryQueue
  let storage: QueueStorage

  beforeEach(() => {
    vi.useFakeTimers()
    storage = createMockStorage()
  })

  afterEach(() => {
    vi.useRealTimers()
    queue?.stop()
  })

  describe('Batch accumulation', () => {
    it('accumulates items until batch size reached', async () => {
      const handler = createMockHandler()
      queue = createDeliveryQueue({
        storage,
        batch: { maxSize: 5, maxWaitMs: 60000 },
      })
      queue.registerHandler('email', handler)
      queue.start()

      // Enqueue 4 items (below batch size)
      for (let i = 0; i < 4; i++) {
        await queue.enqueue({
          channel: 'email',
          payload: { subject: `Test ${i}` },
          recipient: { email: `user${i}@example.com` },
        })
      }

      // Should not have processed yet
      expect(handler).not.toHaveBeenCalled()

      // Enqueue 5th item to trigger batch
      await queue.enqueue({
        channel: 'email',
        payload: { subject: 'Test 4' },
        recipient: { email: 'user4@example.com' },
      })

      // Allow async processing
      await vi.advanceTimersByTimeAsync(0)

      // Batch should have been processed
      expect(handler).toHaveBeenCalledTimes(5)
    })

    it('flushes batch after maxWaitMs', async () => {
      const handler = createMockHandler()
      queue = createDeliveryQueue({
        storage,
        batch: { maxSize: 100, maxWaitMs: 1000 },
      })
      queue.registerHandler('email', handler)
      queue.start()

      // Enqueue 3 items
      for (let i = 0; i < 3; i++) {
        await queue.enqueue({
          channel: 'email',
          payload: { subject: `Test ${i}` },
          recipient: { email: `user${i}@example.com` },
        })
      }

      // Should not have processed yet
      expect(handler).not.toHaveBeenCalled()

      // Advance time to trigger flush
      await vi.advanceTimersByTimeAsync(1000)

      // Batch should have been flushed
      expect(handler).toHaveBeenCalledTimes(3)
    })
  })

  describe('Manual flush', () => {
    it('flushes pending items on demand', async () => {
      const handler = createMockHandler()
      queue = createDeliveryQueue({
        storage,
        batch: { maxSize: 100, maxWaitMs: 60000 },
      })
      queue.registerHandler('email', handler)

      // Enqueue some items
      for (let i = 0; i < 3; i++) {
        await queue.enqueue({
          channel: 'email',
          payload: { subject: `Test ${i}` },
          recipient: { email: `user${i}@example.com` },
        })
      }

      // Manually flush
      await queue.flush()

      expect(handler).toHaveBeenCalledTimes(3)
    })
  })
})

// =============================================================================
// Dead Letter Queue Tests
// =============================================================================

describe('Dead Letter Queue (DLQ)', () => {
  let queue: DeliveryQueue
  let storage: QueueStorage

  beforeEach(() => {
    vi.useFakeTimers()
    storage = createMockStorage()
  })

  afterEach(() => {
    vi.useRealTimers()
    queue?.stop()
  })

  describe('DLQ operations', () => {
    it('moves failed items to DLQ after max retries', async () => {
      const handler = createMockHandler({ failUntilAttempt: 999 })
      queue = createDeliveryQueue({
        storage,
        retry: { maxAttempts: 2, initialDelayMs: 100, backoffMultiplier: 2, jitterFactor: 0 },
      })
      queue.registerHandler('email', handler)

      const result = await queue.enqueue({
        channel: 'email',
        payload: { subject: 'Test' },
        recipient: { email: 'user@example.com' },
      })

      // Exhaust all retries
      await queue.processOne(result.id)
      await vi.advanceTimersByTimeAsync(100)
      await queue.processRetries()

      // Check DLQ
      const dlqEntries = await queue.getDLQEntries()
      expect(dlqEntries).toHaveLength(1)
      expect(dlqEntries[0].originalId).toBe(result.id)
    })

    it('stores original item data in DLQ', async () => {
      const handler = createMockHandler({ failUntilAttempt: 999 })
      queue = createDeliveryQueue({
        storage,
        retry: { maxAttempts: 1, initialDelayMs: 100 },
      })
      queue.registerHandler('email', handler)

      const result = await queue.enqueue({
        channel: 'email',
        payload: { subject: 'Test', body: 'Hello' },
        recipient: { email: 'user@example.com' },
        metadata: { orderId: 'order_123' },
      })

      await queue.processOne(result.id)

      const dlqEntries = await queue.getDLQEntries()
      expect(dlqEntries[0].channel).toBe('email')
      expect(dlqEntries[0].payload).toEqual({ subject: 'Test', body: 'Hello' })
      expect(dlqEntries[0].recipient).toEqual({ email: 'user@example.com' })
      expect(dlqEntries[0].metadata).toEqual({ orderId: 'order_123' })
    })

    it('stores error information in DLQ', async () => {
      const handler = createMockHandler({ failUntilAttempt: 999, failWithError: new Error('Service unavailable') })
      queue = createDeliveryQueue({
        storage,
        retry: { maxAttempts: 1, initialDelayMs: 100 },
      })
      queue.registerHandler('email', handler)

      const result = await queue.enqueue({
        channel: 'email',
        payload: { subject: 'Test' },
        recipient: { email: 'user@example.com' },
      })

      await queue.processOne(result.id)

      const dlqEntries = await queue.getDLQEntries()
      expect(dlqEntries[0].error).toBe('Service unavailable')
      expect(dlqEntries[0].attempts).toBe(1)
    })

    it('stores DLQ entry timestamp', async () => {
      const handler = createMockHandler({ failUntilAttempt: 999 })
      queue = createDeliveryQueue({
        storage,
        retry: { maxAttempts: 1, initialDelayMs: 100 },
      })
      queue.registerHandler('email', handler)

      const result = await queue.enqueue({
        channel: 'email',
        payload: { subject: 'Test' },
        recipient: { email: 'user@example.com' },
      })

      await queue.processOne(result.id)

      const dlqEntries = await queue.getDLQEntries()
      expect(dlqEntries[0].failedAt).toBeDefined()
    })
  })

  describe('DLQ replay', () => {
    it('replays a single DLQ entry', async () => {
      let attempts = 0
      const handler = vi.fn(async () => {
        attempts++
        if (attempts < 3) {
          throw new Error('Failed')
        }
        return { messageId: 'msg_success' }
      })

      queue = createDeliveryQueue({
        storage,
        retry: { maxAttempts: 1, initialDelayMs: 100 },
      })
      queue.registerHandler('email', handler)

      const result = await queue.enqueue({
        channel: 'email',
        payload: { subject: 'Test' },
        recipient: { email: 'user@example.com' },
      })

      // Fail and move to DLQ
      await queue.processOne(result.id)

      const dlqEntries = await queue.getDLQEntries()
      expect(dlqEntries).toHaveLength(1)

      // Replay - still fails
      await queue.replayDLQEntry(dlqEntries[0].id)

      // Replay again - should succeed now
      const replayResult = await queue.replayDLQEntry(dlqEntries[0].id)
      expect(replayResult.success).toBe(true)

      // Entry should be removed from DLQ
      const remainingEntries = await queue.getDLQEntries()
      expect(remainingEntries).toHaveLength(0)
    })

    it('keeps entry in DLQ if replay fails', async () => {
      const handler = createMockHandler({ failUntilAttempt: 999 })
      queue = createDeliveryQueue({
        storage,
        retry: { maxAttempts: 1, initialDelayMs: 100 },
      })
      queue.registerHandler('email', handler)

      const result = await queue.enqueue({
        channel: 'email',
        payload: { subject: 'Test' },
        recipient: { email: 'user@example.com' },
      })

      await queue.processOne(result.id)

      const dlqEntries = await queue.getDLQEntries()
      await queue.replayDLQEntry(dlqEntries[0].id)

      // Entry should still be in DLQ
      const remainingEntries = await queue.getDLQEntries()
      expect(remainingEntries).toHaveLength(1)
    })

    it('replays all DLQ entries', async () => {
      // Use a handler that always fails on first call but succeeds on replay
      // Track attempts per item to ensure independent tracking
      const attemptsByItem = new Map<string, number>()
      const handler = vi.fn(async (item: DeliveryItem) => {
        const attempts = (attemptsByItem.get(item.id) ?? 0) + 1
        attemptsByItem.set(item.id, attempts)

        // Fail on first attempt per item, succeed on second
        if (attempts === 1) {
          throw new Error('First attempt fails')
        }
        return { messageId: `msg_${item.id}` }
      })

      queue = createDeliveryQueue({
        storage,
        retry: { maxAttempts: 1, initialDelayMs: 100 },
      })
      queue.registerHandler('email', handler)

      // Create multiple DLQ entries
      for (let i = 0; i < 3; i++) {
        const result = await queue.enqueue({
          channel: 'email',
          payload: { subject: `Test ${i}` },
          recipient: { email: `user${i}@example.com` },
        })
        await queue.processOne(result.id)
      }

      expect(await queue.getDLQEntries()).toHaveLength(3)

      // Replay all
      const replayResults = await queue.replayAllDLQ()

      expect(replayResults.successful).toBe(3)
      expect(replayResults.failed).toBe(0)
      expect(await queue.getDLQEntries()).toHaveLength(0)
    })
  })

  describe('DLQ management', () => {
    it('removes DLQ entry manually', async () => {
      const handler = createMockHandler({ failUntilAttempt: 999 })
      queue = createDeliveryQueue({
        storage,
        retry: { maxAttempts: 1, initialDelayMs: 100 },
      })
      queue.registerHandler('email', handler)

      const result = await queue.enqueue({
        channel: 'email',
        payload: { subject: 'Test' },
        recipient: { email: 'user@example.com' },
      })

      await queue.processOne(result.id)

      const dlqEntries = await queue.getDLQEntries()
      await queue.removeDLQEntry(dlqEntries[0].id)

      expect(await queue.getDLQEntries()).toHaveLength(0)
    })

    it('clears all DLQ entries', async () => {
      const handler = createMockHandler({ failUntilAttempt: 999 })
      queue = createDeliveryQueue({
        storage,
        retry: { maxAttempts: 1, initialDelayMs: 100 },
      })
      queue.registerHandler('email', handler)

      // Create multiple DLQ entries
      for (let i = 0; i < 5; i++) {
        const result = await queue.enqueue({
          channel: 'email',
          payload: { subject: `Test ${i}` },
          recipient: { email: `user${i}@example.com` },
        })
        await queue.processOne(result.id)
      }

      expect(await queue.getDLQEntries()).toHaveLength(5)

      await queue.clearDLQ()

      expect(await queue.getDLQEntries()).toHaveLength(0)
    })

    it('gets DLQ count', async () => {
      const handler = createMockHandler({ failUntilAttempt: 999 })
      queue = createDeliveryQueue({
        storage,
        retry: { maxAttempts: 1, initialDelayMs: 100 },
      })
      queue.registerHandler('email', handler)

      for (let i = 0; i < 3; i++) {
        const result = await queue.enqueue({
          channel: 'email',
          payload: { subject: `Test ${i}` },
          recipient: { email: `user${i}@example.com` },
        })
        await queue.processOne(result.id)
      }

      expect(await queue.getDLQCount()).toBe(3)
    })
  })
})

// =============================================================================
// Status Tracking Tests
// =============================================================================

describe('Delivery Status Tracking', () => {
  let queue: DeliveryQueue
  let storage: QueueStorage

  beforeEach(() => {
    storage = createMockStorage()
    queue = createDeliveryQueue({ storage })
  })

  describe('getStatus()', () => {
    it('returns queued status for new items', async () => {
      const result = await queue.enqueue({
        channel: 'email',
        payload: { subject: 'Test' },
        recipient: { email: 'user@example.com' },
      })

      const status = await queue.getStatus(result.id)

      expect(status?.status).toBe('queued')
      expect(status?.queuedAt).toBeDefined()
    })

    it('returns sent status after successful delivery', async () => {
      const handler = createMockHandler()
      queue.registerHandler('email', handler)

      const result = await queue.enqueue({
        channel: 'email',
        payload: { subject: 'Test' },
        recipient: { email: 'user@example.com' },
      })

      await queue.processOne(result.id)

      const status = await queue.getStatus(result.id)
      expect(status?.status).toBe('sent')
      expect(status?.sentAt).toBeDefined()
      expect(status?.messageId).toBeDefined()
    })

    it('returns failed status after exhausted retries', async () => {
      vi.useFakeTimers()
      const handler = createMockHandler({ failUntilAttempt: 999 })
      queue = createDeliveryQueue({
        storage,
        retry: { maxAttempts: 1, initialDelayMs: 100 },
      })
      queue.registerHandler('email', handler)

      const result = await queue.enqueue({
        channel: 'email',
        payload: { subject: 'Test' },
        recipient: { email: 'user@example.com' },
      })

      await queue.processOne(result.id)

      const status = await queue.getStatus(result.id)
      expect(status?.status).toBe('failed')
      expect(status?.failedAt).toBeDefined()
      expect(status?.lastError).toBeDefined()

      vi.useRealTimers()
    })

    it('returns pending_retry status during retry window', async () => {
      vi.useFakeTimers()
      const handler = createMockHandler({ failUntilAttempt: 3 })
      queue = createDeliveryQueue({
        storage,
        retry: { maxAttempts: 5, initialDelayMs: 1000 },
      })
      queue.registerHandler('email', handler)

      const result = await queue.enqueue({
        channel: 'email',
        payload: { subject: 'Test' },
        recipient: { email: 'user@example.com' },
      })

      await queue.processOne(result.id)

      const status = await queue.getStatus(result.id)
      expect(status?.status).toBe('pending_retry')
      expect(status?.nextRetryAt).toBeDefined()

      vi.useRealTimers()
    })

    it('returns undefined for unknown ID', async () => {
      const status = await queue.getStatus('unknown_id')
      expect(status).toBeUndefined()
    })
  })

  describe('getStatuses()', () => {
    it('returns statuses for multiple items', async () => {
      const handler = createMockHandler()
      queue.registerHandler('email', handler)

      const results = await queue.enqueueBatch([
        { channel: 'email', payload: { subject: 'Test 1' }, recipient: { email: 'user1@example.com' } },
        { channel: 'email', payload: { subject: 'Test 2' }, recipient: { email: 'user2@example.com' } },
      ])

      await queue.processOne(results[0].id)

      const statuses = await queue.getStatuses(results.map((r) => r.id))

      expect(statuses.get(results[0].id)?.status).toBe('sent')
      expect(statuses.get(results[1].id)?.status).toBe('queued')
    })
  })
})

// =============================================================================
// Queue Statistics Tests
// =============================================================================

describe('Queue Statistics', () => {
  let queue: DeliveryQueue
  let storage: QueueStorage

  beforeEach(() => {
    vi.useFakeTimers()
    storage = createMockStorage()
  })

  afterEach(() => {
    vi.useRealTimers()
    queue?.stop()
  })

  describe('getStats()', () => {
    it('returns queue statistics', async () => {
      const handler = createMockHandler()
      const failingHandler = createMockHandler({ failUntilAttempt: 999 })

      queue = createDeliveryQueue({
        storage,
        retry: { maxAttempts: 1, initialDelayMs: 100 },
      })
      queue.registerHandler('email', handler)
      queue.registerHandler('sms', failingHandler)

      // Enqueue some items
      const emailResults = await queue.enqueueBatch(
        Array.from({ length: 5 }, (_, i) => ({
          channel: 'email' as const,
          payload: { subject: `Test ${i}` },
          recipient: { email: `user${i}@example.com` },
        }))
      )

      const smsResults = await queue.enqueueBatch(
        Array.from({ length: 3 }, (_, i) => ({
          channel: 'sms' as const,
          payload: { body: `SMS ${i}` },
          recipient: { phone: `+123456789${i}` },
        }))
      )

      // Process all
      await queue.processBatch([...emailResults, ...smsResults].map((r) => r.id))

      const stats = await queue.getStats()

      expect(stats.total).toBe(8)
      expect(stats.sent).toBe(5)
      expect(stats.failed).toBe(3)
      expect(stats.byChannel.email.sent).toBe(5)
      expect(stats.byChannel.sms.failed).toBe(3)
    })

    it('tracks queued items', async () => {
      queue = createDeliveryQueue({ storage })

      await queue.enqueueBatch(
        Array.from({ length: 5 }, (_, i) => ({
          channel: 'email' as const,
          payload: { subject: `Test ${i}` },
          recipient: { email: `user${i}@example.com` },
        }))
      )

      const stats = await queue.getStats()

      expect(stats.queued).toBe(5)
    })

    it('tracks DLQ count in stats', async () => {
      const handler = createMockHandler({ failUntilAttempt: 999 })
      queue = createDeliveryQueue({
        storage,
        retry: { maxAttempts: 1, initialDelayMs: 100 },
      })
      queue.registerHandler('email', handler)

      const results = await queue.enqueueBatch(
        Array.from({ length: 3 }, (_, i) => ({
          channel: 'email' as const,
          payload: { subject: `Test ${i}` },
          recipient: { email: `user${i}@example.com` },
        }))
      )

      await queue.processBatch(results.map((r) => r.id))

      const stats = await queue.getStats()

      expect(stats.dlq).toBe(3)
    })
  })
})

// =============================================================================
// Persistence Tests
// =============================================================================

describe('Persistence via Storage', () => {
  let storage: QueueStorage

  beforeEach(() => {
    storage = createMockStorage()
  })

  describe('Item persistence', () => {
    it('persists queued items', async () => {
      const queue = createDeliveryQueue({ storage })

      const result = await queue.enqueue({
        channel: 'email',
        payload: { subject: 'Test' },
        recipient: { email: 'user@example.com' },
      })

      const stored = await storage.get<DeliveryItem>(`delivery:${result.id}`)
      expect(stored).toBeDefined()
      expect(stored?.channel).toBe('email')
    })

    it('persists status updates', async () => {
      const handler = createMockHandler()
      const queue = createDeliveryQueue({ storage })
      queue.registerHandler('email', handler)

      const result = await queue.enqueue({
        channel: 'email',
        payload: { subject: 'Test' },
        recipient: { email: 'user@example.com' },
      })

      await queue.processOne(result.id)

      const stored = await storage.get<DeliveryItem>(`delivery:${result.id}`)
      expect(stored?.status).toBe('sent')
    })

    it('persists DLQ entries', async () => {
      vi.useFakeTimers()
      const handler = createMockHandler({ failUntilAttempt: 999 })
      const queue = createDeliveryQueue({
        storage,
        retry: { maxAttempts: 1, initialDelayMs: 100 },
      })
      queue.registerHandler('email', handler)

      const result = await queue.enqueue({
        channel: 'email',
        payload: { subject: 'Test' },
        recipient: { email: 'user@example.com' },
      })

      await queue.processOne(result.id)

      const dlqItems = await storage.list<DeadLetterEntry>('dlq:')
      expect(dlqItems.size).toBe(1)

      vi.useRealTimers()
    })
  })

  describe('Recovery from storage', () => {
    it('recovers pending items on restart', async () => {
      const handler = createMockHandler()

      // First queue instance enqueues items
      const queue1 = createDeliveryQueue({ storage })
      queue1.registerHandler('email', handler)

      await queue1.enqueueBatch(
        Array.from({ length: 3 }, (_, i) => ({
          channel: 'email' as const,
          payload: { subject: `Test ${i}` },
          recipient: { email: `user${i}@example.com` },
        }))
      )

      // Simulate restart with new queue instance
      const queue2 = createDeliveryQueue({ storage })
      queue2.registerHandler('email', handler)

      // Should be able to process recovered items
      await queue2.processPending()

      expect(handler).toHaveBeenCalledTimes(3)
    })
  })
})

// =============================================================================
// Module Exports Tests
// =============================================================================

describe('Module Exports', () => {
  it('exports factory function', () => {
    expect(createDeliveryQueue).toBeDefined()
    expect(typeof createDeliveryQueue).toBe('function')
  })

  it('exports DeliveryQueue class', () => {
    expect(DeliveryQueue).toBeDefined()
    expect(typeof DeliveryQueue).toBe('function')
  })
})
