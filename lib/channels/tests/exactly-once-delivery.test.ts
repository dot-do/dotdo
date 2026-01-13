/**
 * ExactlyOnceChannelDelivery Tests
 *
 * TDD tests for exactly-once delivery guarantees in channel delivery:
 * 1. Idempotency keys - unique keys prevent duplicate delivery
 * 2. Deduplication logic - time-based sliding window for replay protection
 * 3. Delivery acknowledgment - durable record of deliveries
 * 4. Retry with idempotency - exponential backoff with dedup
 *
 * @module lib/channels/tests/exactly-once-delivery.test
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  ExactlyOnceChannelDelivery,
  createExactlyOnceChannelDelivery,
  type ChannelDeliveryEvent,
  type ChannelDeliveryResult,
  type ChannelDeliveryOptions,
  type ChannelDeliveryCheckpoint,
  type DeliveryAcknowledgment,
} from '../exactly-once-delivery'

// ============================================================================
// TEST HELPERS
// ============================================================================

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createDelivery<T = unknown>(
  options?: ChannelDeliveryOptions<T>
): ExactlyOnceChannelDelivery<T> {
  return createExactlyOnceChannelDelivery<T>(options)
}

interface TestMessage {
  userId: string
  content: string
  priority?: 'high' | 'normal' | 'low'
}

// ============================================================================
// IDEMPOTENCY KEYS
// ============================================================================

describe('ExactlyOnceChannelDelivery', () => {
  describe('idempotency keys - unique keys prevent duplicate delivery', () => {
    it('should deliver a message successfully with idempotency key', async () => {
      const delivered: ChannelDeliveryEvent[] = []
      const delivery = createDelivery({
        onDeliver: async (event) => {
          delivered.push(event)
        },
      })

      const result = await delivery.deliver({
        idempotencyKey: 'msg-001',
        channel: 'slack',
        recipient: '#general',
        payload: { message: 'Hello world' },
      })

      expect(result.success).toBe(true)
      expect(result.wasDuplicate).toBe(false)
      expect(result.status).toBe('delivered')
      expect(delivered).toHaveLength(1)
      expect(delivered[0]!.idempotencyKey).toBe('msg-001')
    })

    it('should skip duplicate delivery with same idempotency key', async () => {
      const delivered: string[] = []
      const delivery = createDelivery({
        onDeliver: async (event) => {
          delivered.push(event.idempotencyKey)
        },
      })

      const result1 = await delivery.deliver({
        idempotencyKey: 'msg-dup',
        channel: 'email',
        recipient: 'user@example.com',
        payload: { message: 'First attempt' },
      })

      const result2 = await delivery.deliver({
        idempotencyKey: 'msg-dup',
        channel: 'email',
        recipient: 'user@example.com',
        payload: { message: 'Second attempt - different content' },
      })

      expect(result1.success).toBe(true)
      expect(result1.wasDuplicate).toBe(false)
      expect(result2.success).toBe(true)
      expect(result2.wasDuplicate).toBe(true)
      expect(delivered).toHaveLength(1) // Only delivered once
    })

    it('should process different idempotency keys independently', async () => {
      const delivered: string[] = []
      const delivery = createDelivery({
        onDeliver: async (event) => {
          delivered.push(event.idempotencyKey)
        },
      })

      await delivery.deliver({ idempotencyKey: 'msg-a', channel: 'slack', recipient: '#ch', payload: {} })
      await delivery.deliver({ idempotencyKey: 'msg-b', channel: 'slack', recipient: '#ch', payload: {} })
      await delivery.deliver({ idempotencyKey: 'msg-c', channel: 'slack', recipient: '#ch', payload: {} })

      expect(delivered).toHaveLength(3)
      expect(delivered).toContain('msg-a')
      expect(delivered).toContain('msg-b')
      expect(delivered).toContain('msg-c')
    })

    it('should generate idempotency key if not provided', async () => {
      const delivered: ChannelDeliveryEvent[] = []
      const delivery = createDelivery({
        onDeliver: async (event) => {
          delivered.push(event)
        },
      })

      const result = await delivery.deliver({
        channel: 'discord',
        recipient: 'guild-123',
        payload: { message: 'Auto-keyed message' },
      })

      expect(result.success).toBe(true)
      expect(result.idempotencyKey).toBeDefined()
      expect(result.idempotencyKey.startsWith('ck-')).toBe(true) // Channel key prefix
    })

    it('should check if idempotency key was already delivered', async () => {
      const delivery = createDelivery({
        onDeliver: async () => {},
      })

      expect(await delivery.isDelivered('msg-check')).toBe(false)

      await delivery.deliver({
        idempotencyKey: 'msg-check',
        channel: 'email',
        recipient: 'test@test.com',
        payload: {},
      })

      expect(await delivery.isDelivered('msg-check')).toBe(true)
      expect(await delivery.isDelivered('msg-other')).toBe(false)
    })

    it('should handle concurrent delivery of same idempotency key', async () => {
      let deliveryCount = 0
      const delivery = createDelivery({
        onDeliver: async () => {
          deliveryCount++
          await delay(50) // Simulate slow delivery
        },
      })

      const [result1, result2] = await Promise.all([
        delivery.deliver({ idempotencyKey: 'concurrent', channel: 'slack', recipient: '#ch', payload: { n: 1 } }),
        delivery.deliver({ idempotencyKey: 'concurrent', channel: 'slack', recipient: '#ch', payload: { n: 2 } }),
      ])

      expect(deliveryCount).toBe(1) // Only delivered once
      expect(result1.idempotencyKey).toBe(result2.idempotencyKey)
    })
  })

  // ============================================================================
  // DEDUPLICATION LOGIC
  // ============================================================================

  describe('deduplication logic - time-based sliding window', () => {
    it('should allow redelivery after deduplication window expires', async () => {
      const delivered: number[] = []
      const delivery = createDelivery({
        onDeliver: async () => {
          delivered.push(Date.now())
        },
        deduplicationWindowMs: 50, // Short window for testing
      })

      await delivery.deliver({ idempotencyKey: 'msg-expire', channel: 'slack', recipient: '#ch', payload: {} })
      expect(delivered).toHaveLength(1)

      // Immediate retry should be skipped
      await delivery.deliver({ idempotencyKey: 'msg-expire', channel: 'slack', recipient: '#ch', payload: {} })
      expect(delivered).toHaveLength(1)

      // Wait for window to expire
      await delay(100)

      // Should be delivered again
      await delivery.deliver({ idempotencyKey: 'msg-expire', channel: 'slack', recipient: '#ch', payload: {} })
      expect(delivered).toHaveLength(2)
    })

    it('should not allow redelivery before window expires', async () => {
      let count = 0
      const delivery = createDelivery({
        onDeliver: async () => {
          count++
        },
        deduplicationWindowMs: 1000, // 1 second window
      })

      await delivery.deliver({ idempotencyKey: 'msg-window', channel: 'slack', recipient: '#ch', payload: {} })
      await delivery.deliver({ idempotencyKey: 'msg-window', channel: 'slack', recipient: '#ch', payload: {} })
      await delivery.deliver({ idempotencyKey: 'msg-window', channel: 'slack', recipient: '#ch', payload: {} })

      expect(count).toBe(1)
    })

    it('should cleanup expired entries from deduplication cache', async () => {
      const delivery = createDelivery({
        onDeliver: async () => {},
        deduplicationWindowMs: 50,
      })

      await delivery.deliver({ idempotencyKey: 'cleanup-1', channel: 'slack', recipient: '#ch', payload: {} })
      await delivery.deliver({ idempotencyKey: 'cleanup-2', channel: 'slack', recipient: '#ch', payload: {} })

      expect(delivery.getStats().deduplicationCacheSize).toBe(2)

      await delay(100)

      const cleaned = delivery.cleanupExpiredEntries()
      expect(cleaned).toBe(2)
      expect(delivery.getStats().deduplicationCacheSize).toBe(0)
    })

    it('should track deduplication cache size', async () => {
      const delivery = createDelivery({
        onDeliver: async () => {},
        deduplicationWindowMs: 60_000,
      })

      for (let i = 0; i < 5; i++) {
        await delivery.deliver({ idempotencyKey: `msg-${i}`, channel: 'slack', recipient: '#ch', payload: {} })
      }

      expect(delivery.getStats().deduplicationCacheSize).toBe(5)
    })

    it('should use custom deduplication key generator', async () => {
      const delivered: string[] = []
      const delivery = createDelivery({
        onDeliver: async (event) => {
          delivered.push(event.idempotencyKey)
        },
        generateDeduplicationKey: (event) => {
          // Custom key based on channel and recipient
          return `${event.channel}:${event.recipient}`
        },
      })

      // Different idempotency keys but same channel/recipient
      await delivery.deliver({ idempotencyKey: 'msg-1', channel: 'slack', recipient: '#general', payload: { text: 'first' } })
      await delivery.deliver({ idempotencyKey: 'msg-2', channel: 'slack', recipient: '#general', payload: { text: 'second' } })

      // Should only deliver once due to custom dedup key
      expect(delivered).toHaveLength(1)
    })
  })

  // ============================================================================
  // DELIVERY ACKNOWLEDGMENT
  // ============================================================================

  describe('delivery acknowledgment - durable record', () => {
    it('should record delivery acknowledgment on success', async () => {
      const delivery = createDelivery({
        onDeliver: async () => {},
      })

      const result = await delivery.deliver({
        idempotencyKey: 'msg-ack',
        channel: 'email',
        recipient: 'user@example.com',
        payload: { subject: 'Test' },
      })

      const ack = delivery.getAcknowledgment('msg-ack')
      expect(ack).toBeDefined()
      expect(ack!.status).toBe('delivered')
      expect(ack!.deliveredAt).toBeDefined()
      expect(ack!.channel).toBe('email')
      expect(ack!.recipient).toBe('user@example.com')
    })

    it('should not record acknowledgment on failure without exhausted retries', async () => {
      const delivery = createDelivery({
        onDeliver: async () => {
          throw new Error('Temporary failure')
        },
        maxRetryAttempts: 3,
        retryDelayMs: 10,
      })

      // Will fail after all retries
      await delivery.deliver({
        idempotencyKey: 'msg-fail-ack',
        channel: 'slack',
        recipient: '#ch',
        payload: {},
      })

      const ack = delivery.getAcknowledgment('msg-fail-ack')
      expect(ack).toBeDefined()
      expect(ack!.status).toBe('failed')
      expect(ack!.attempts).toBe(3)
      expect(ack!.lastError).toBe('Temporary failure')
    })

    it('should persist acknowledgments for recovery', async () => {
      const delivery = createDelivery({
        onDeliver: async () => {},
      })

      await delivery.deliver({ idempotencyKey: 'persist-1', channel: 'slack', recipient: '#ch', payload: {} })
      await delivery.deliver({ idempotencyKey: 'persist-2', channel: 'email', recipient: 'a@b.c', payload: {} })

      const acks = delivery.getAllAcknowledgments()
      expect(acks).toHaveLength(2)
      expect(acks.map(a => a.idempotencyKey)).toContain('persist-1')
      expect(acks.map(a => a.idempotencyKey)).toContain('persist-2')
    })

    it('should include delivery metadata in acknowledgment', async () => {
      const delivery = createDelivery({
        onDeliver: async () => {
          return { messageId: 'ext-msg-123', provider: 'sendgrid' }
        },
      })

      await delivery.deliver({
        idempotencyKey: 'msg-meta',
        channel: 'email',
        recipient: 'user@test.com',
        payload: {},
        metadata: { source: 'notification-service', priority: 'high' },
      })

      const ack = delivery.getAcknowledgment('msg-meta')
      expect(ack!.metadata).toEqual({ source: 'notification-service', priority: 'high' })
      expect(ack!.externalId).toBe('ext-msg-123')
    })

    it('should record attempt history in acknowledgment', async () => {
      let attempt = 0
      const delivery = createDelivery({
        onDeliver: async () => {
          attempt++
          if (attempt < 3) {
            throw new Error(`Attempt ${attempt} failed`)
          }
        },
        maxRetryAttempts: 3,
        retryDelayMs: 10,
      })

      await delivery.deliver({
        idempotencyKey: 'msg-attempts',
        channel: 'slack',
        recipient: '#ch',
        payload: {},
      })

      const ack = delivery.getAcknowledgment('msg-attempts')
      expect(ack!.attempts).toBe(3)
      expect(ack!.attemptHistory).toHaveLength(3)
      expect(ack!.attemptHistory[0]!.error).toBe('Attempt 1 failed')
      expect(ack!.attemptHistory[1]!.error).toBe('Attempt 2 failed')
      expect(ack!.attemptHistory[2]!.success).toBe(true)
    })
  })

  // ============================================================================
  // RETRY WITH IDEMPOTENCY
  // ============================================================================

  describe('retry with idempotency - exponential backoff with dedup', () => {
    it('should retry on delivery failure', async () => {
      let attempts = 0
      const delivery = createDelivery({
        onDeliver: async () => {
          attempts++
          if (attempts < 3) {
            throw new Error(`Attempt ${attempts} failed`)
          }
        },
        maxRetryAttempts: 3,
        retryDelayMs: 10,
      })

      const result = await delivery.deliver({
        idempotencyKey: 'msg-retry',
        channel: 'slack',
        recipient: '#ch',
        payload: {},
      })

      expect(result.success).toBe(true)
      expect(attempts).toBe(3)
    })

    it('should use exponential backoff for retries', async () => {
      const timestamps: number[] = []
      const delivery = createDelivery({
        onDeliver: async () => {
          timestamps.push(Date.now())
          if (timestamps.length < 3) {
            throw new Error('Retry needed')
          }
        },
        maxRetryAttempts: 3,
        retryDelayMs: 20,
        retryBackoffMultiplier: 2,
      })

      await delivery.deliver({ idempotencyKey: 'msg-backoff', channel: 'slack', recipient: '#ch', payload: {} })

      expect(timestamps).toHaveLength(3)
      const delay1 = timestamps[1]! - timestamps[0]!
      const delay2 = timestamps[2]! - timestamps[1]!

      expect(delay1).toBeGreaterThanOrEqual(15) // ~20ms with jitter
      expect(delay2).toBeGreaterThanOrEqual(30) // ~40ms with jitter
    })

    it('should cap retry delay at maxRetryDelayMs', async () => {
      const timestamps: number[] = []
      const delivery = createDelivery({
        onDeliver: async () => {
          timestamps.push(Date.now())
          if (timestamps.length < 5) {
            throw new Error('Retry needed')
          }
        },
        maxRetryAttempts: 5,
        retryDelayMs: 10,
        retryBackoffMultiplier: 10, // Would grow quickly
        maxRetryDelayMs: 50,
      })

      await delivery.deliver({ idempotencyKey: 'msg-cap', channel: 'slack', recipient: '#ch', payload: {} })

      // All delays should be capped at ~50ms
      for (let i = 1; i < timestamps.length; i++) {
        const delay = timestamps[i]! - timestamps[i - 1]!
        expect(delay).toBeLessThanOrEqual(100) // Allow some variance
      }
    })

    it('should fail after max retries exhausted', async () => {
      const delivery = createDelivery({
        onDeliver: async () => {
          throw new Error('Always fails')
        },
        maxRetryAttempts: 2,
        retryDelayMs: 10,
      })

      const result = await delivery.deliver({
        idempotencyKey: 'msg-exhaust',
        channel: 'slack',
        recipient: '#ch',
        payload: {},
      })

      expect(result.success).toBe(false)
      expect(result.status).toBe('failed')
      expect(result.error).toBe('Always fails')
    })

    it('should maintain idempotency during retry', async () => {
      let deliveryCount = 0
      const delivery = createDelivery({
        onDeliver: async () => {
          deliveryCount++
        },
      })

      // First delivery succeeds
      await delivery.deliver({ idempotencyKey: 'msg-idem-retry', channel: 'slack', recipient: '#ch', payload: {} })

      // Retry with same key should be skipped (already delivered)
      await delivery.deliver({ idempotencyKey: 'msg-idem-retry', channel: 'slack', recipient: '#ch', payload: {} })
      await delivery.deliver({ idempotencyKey: 'msg-idem-retry', channel: 'slack', recipient: '#ch', payload: {} })

      expect(deliveryCount).toBe(1)
    })

    it('should allow retry of failed delivery with same idempotency key', async () => {
      let shouldFail = true
      let attempts = 0
      const delivery = createDelivery({
        onDeliver: async () => {
          attempts++
          if (shouldFail) {
            throw new Error('Temporary failure')
          }
        },
        maxRetryAttempts: 1, // Only 1 attempt before failing
        retryDelayMs: 10,
      })

      // First attempt fails
      const result1 = await delivery.deliver({
        idempotencyKey: 'msg-retry-after-fail',
        channel: 'slack',
        recipient: '#ch',
        payload: {},
      })
      expect(result1.success).toBe(false)

      // Fix the issue and retry
      shouldFail = false
      delivery.clearAcknowledgment('msg-retry-after-fail') // Allow retry

      const result2 = await delivery.deliver({
        idempotencyKey: 'msg-retry-after-fail',
        channel: 'slack',
        recipient: '#ch',
        payload: {},
      })

      expect(result2.success).toBe(true)
      expect(attempts).toBe(2) // 1 failed + 1 success
    })

    it('should use custom retry policy', async () => {
      let attemptErrors: string[] = []
      const delivery = createDelivery({
        onDeliver: async () => {
          throw new Error('Fail')
        },
        maxRetryAttempts: 3,
        shouldRetry: (error, attempt) => {
          attemptErrors.push(`${attempt}: ${error.message}`)
          return attempt < 2 // Only retry once
        },
      })

      await delivery.deliver({ idempotencyKey: 'msg-policy', channel: 'slack', recipient: '#ch', payload: {} })

      expect(attemptErrors).toHaveLength(2)
      expect(attemptErrors[0]).toBe('1: Fail')
      expect(attemptErrors[1]).toBe('2: Fail')
    })
  })

  // ============================================================================
  // BATCH DELIVERY
  // ============================================================================

  describe('batch delivery', () => {
    it('should deliver batch of messages', async () => {
      const delivered: string[] = []
      const delivery = createDelivery({
        onDeliver: async (event) => {
          delivered.push(event.idempotencyKey)
        },
      })

      const events: ChannelDeliveryEvent[] = [
        { idempotencyKey: 'batch-1', channel: 'slack', recipient: '#ch', payload: {} },
        { idempotencyKey: 'batch-2', channel: 'email', recipient: 'a@b.c', payload: {} },
        { idempotencyKey: 'batch-3', channel: 'discord', recipient: 'guild', payload: {} },
      ]

      const results = await delivery.deliverBatch(events)

      expect(results).toHaveLength(3)
      expect(results.every(r => r.success)).toBe(true)
      expect(delivered).toHaveLength(3)
    })

    it('should maintain order in batch delivery', async () => {
      const order: string[] = []
      const delivery = createDelivery({
        onDeliver: async (event) => {
          order.push(event.idempotencyKey)
        },
      })

      const events: ChannelDeliveryEvent[] = [
        { idempotencyKey: 'first', channel: 'slack', recipient: '#ch', payload: {} },
        { idempotencyKey: 'second', channel: 'slack', recipient: '#ch', payload: {} },
        { idempotencyKey: 'third', channel: 'slack', recipient: '#ch', payload: {} },
      ]

      await delivery.deliverBatch(events)

      expect(order).toEqual(['first', 'second', 'third'])
    })

    it('should handle partial batch failures', async () => {
      let count = 0
      const delivery = createDelivery({
        onDeliver: async () => {
          count++
          if (count === 2) {
            throw new Error('Second message fails')
          }
        },
        maxRetryAttempts: 1,
      })

      const events: ChannelDeliveryEvent[] = [
        { idempotencyKey: 'ok-1', channel: 'slack', recipient: '#ch', payload: {} },
        { idempotencyKey: 'fail', channel: 'slack', recipient: '#ch', payload: {} },
        { idempotencyKey: 'ok-2', channel: 'slack', recipient: '#ch', payload: {} },
      ]

      const results = await delivery.deliverBatch(events)

      expect(results[0]!.success).toBe(true)
      expect(results[1]!.success).toBe(false)
      expect(results[2]!.success).toBe(true)
    })

    it('should deduplicate within batch', async () => {
      const delivered: string[] = []
      const delivery = createDelivery({
        onDeliver: async (event) => {
          delivered.push(event.idempotencyKey)
        },
      })

      const events: ChannelDeliveryEvent[] = [
        { idempotencyKey: 'dup', channel: 'slack', recipient: '#ch', payload: { n: 1 } },
        { idempotencyKey: 'unique', channel: 'slack', recipient: '#ch', payload: {} },
        { idempotencyKey: 'dup', channel: 'slack', recipient: '#ch', payload: { n: 2 } }, // Duplicate
      ]

      const results = await delivery.deliverBatch(events)

      expect(results[0]!.wasDuplicate).toBe(false)
      expect(results[1]!.wasDuplicate).toBe(false)
      expect(results[2]!.wasDuplicate).toBe(true)
      expect(delivered).toHaveLength(2)
    })
  })

  // ============================================================================
  // CHECKPOINT AND RECOVERY
  // ============================================================================

  describe('checkpoint and recovery', () => {
    it('should capture checkpoint state', async () => {
      const delivery = createDelivery({
        onDeliver: async () => {},
      })

      await delivery.deliver({ idempotencyKey: 'ckpt-1', channel: 'slack', recipient: '#ch', payload: {} })
      await delivery.deliver({ idempotencyKey: 'ckpt-2', channel: 'email', recipient: 'a@b.c', payload: {} })

      const checkpoint = delivery.getCheckpoint()

      expect(checkpoint.version).toBe(1)
      expect(checkpoint.deliveredKeys.has('ckpt-1')).toBe(true)
      expect(checkpoint.deliveredKeys.has('ckpt-2')).toBe(true)
      expect(checkpoint.acknowledgments).toHaveLength(2)
    })

    it('should restore from checkpoint', async () => {
      const delivery = createDelivery({
        onDeliver: async () => {},
        deduplicationWindowMs: 60_000,
      })

      const checkpoint: ChannelDeliveryCheckpoint = {
        deliveredKeys: new Map([
          ['restored-1', Date.now()],
          ['restored-2', Date.now()],
        ]),
        acknowledgments: [],
        checkpointedAt: Date.now(),
        version: 1,
      }

      delivery.restoreFromCheckpoint(checkpoint)

      // Should recognize restored keys as delivered
      expect(await delivery.isDelivered('restored-1')).toBe(true)
      expect(await delivery.isDelivered('restored-2')).toBe(true)
      expect(await delivery.isDelivered('new-key')).toBe(false)
    })

    it('should filter expired keys during restore', async () => {
      const delivery = createDelivery({
        onDeliver: async () => {},
        deduplicationWindowMs: 100,
      })

      const checkpoint: ChannelDeliveryCheckpoint = {
        deliveredKeys: new Map([
          ['expired', Date.now() - 200], // Expired
          ['valid', Date.now()], // Valid
        ]),
        acknowledgments: [],
        checkpointedAt: Date.now(),
        version: 1,
      }

      delivery.restoreFromCheckpoint(checkpoint)

      expect(await delivery.isDelivered('expired')).toBe(false)
      expect(await delivery.isDelivered('valid')).toBe(true)
    })

    it('should restore acknowledgments from checkpoint', async () => {
      const delivery = createDelivery({
        onDeliver: async () => {},
      })

      const checkpoint: ChannelDeliveryCheckpoint = {
        deliveredKeys: new Map([['ack-restore', Date.now()]]),
        acknowledgments: [
          {
            idempotencyKey: 'ack-restore',
            status: 'delivered',
            channel: 'slack',
            recipient: '#general',
            deliveredAt: Date.now() - 1000,
            attempts: 1,
            attemptHistory: [],
          },
        ],
        checkpointedAt: Date.now(),
        version: 1,
      }

      delivery.restoreFromCheckpoint(checkpoint)

      const ack = delivery.getAcknowledgment('ack-restore')
      expect(ack).toBeDefined()
      expect(ack!.status).toBe('delivered')
      expect(ack!.channel).toBe('slack')
    })
  })

  // ============================================================================
  // STATISTICS
  // ============================================================================

  describe('statistics', () => {
    it('should track delivery stats', async () => {
      const delivery = createDelivery({
        onDeliver: async () => {},
      })

      await delivery.deliver({ idempotencyKey: 'stat-1', channel: 'slack', recipient: '#ch', payload: {} })
      await delivery.deliver({ idempotencyKey: 'stat-2', channel: 'email', recipient: 'a@b.c', payload: {} })
      await delivery.deliver({ idempotencyKey: 'stat-1', channel: 'slack', recipient: '#ch', payload: {} }) // Dup

      const stats = delivery.getStats()

      expect(stats.totalDelivered).toBe(2)
      expect(stats.duplicatesSkipped).toBe(1)
    })

    it('should track failure stats', async () => {
      const delivery = createDelivery({
        onDeliver: async () => {
          throw new Error('Fail')
        },
        maxRetryAttempts: 1,
      })

      await delivery.deliver({ idempotencyKey: 'fail-stat', channel: 'slack', recipient: '#ch', payload: {} })

      const stats = delivery.getStats()

      expect(stats.totalFailed).toBe(1)
    })

    it('should calculate average latency', async () => {
      const delivery = createDelivery({
        onDeliver: async () => {
          await delay(10)
        },
      })

      await delivery.deliver({ idempotencyKey: 'latency-1', channel: 'slack', recipient: '#ch', payload: {} })
      await delivery.deliver({ idempotencyKey: 'latency-2', channel: 'slack', recipient: '#ch', payload: {} })

      const stats = delivery.getStats()

      expect(stats.avgDeliveryLatencyMs).toBeGreaterThan(10)
    })

    it('should track per-channel stats', async () => {
      const delivery = createDelivery({
        onDeliver: async () => {},
      })

      await delivery.deliver({ idempotencyKey: 's1', channel: 'slack', recipient: '#ch', payload: {} })
      await delivery.deliver({ idempotencyKey: 's2', channel: 'slack', recipient: '#ch', payload: {} })
      await delivery.deliver({ idempotencyKey: 'e1', channel: 'email', recipient: 'a@b.c', payload: {} })

      const stats = delivery.getStats()

      expect(stats.byChannel.slack).toBe(2)
      expect(stats.byChannel.email).toBe(1)
    })
  })

  // ============================================================================
  // LIFECYCLE
  // ============================================================================

  describe('lifecycle', () => {
    it('should clear all state', async () => {
      const delivery = createDelivery({
        onDeliver: async () => {},
      })

      await delivery.deliver({ idempotencyKey: 'clear-test', channel: 'slack', recipient: '#ch', payload: {} })

      delivery.clear()

      expect(await delivery.isDelivered('clear-test')).toBe(false)
      expect(delivery.getAcknowledgment('clear-test')).toBeUndefined()
      expect(delivery.getStats().totalDelivered).toBe(0)
    })
  })

  // ============================================================================
  // FACTORY FUNCTION
  // ============================================================================

  describe('factory function', () => {
    it('should create an ExactlyOnceChannelDelivery instance', () => {
      const delivery = createExactlyOnceChannelDelivery()
      expect(delivery).toBeInstanceOf(ExactlyOnceChannelDelivery)
    })

    it('should accept configuration options', () => {
      const delivery = createExactlyOnceChannelDelivery({
        deduplicationWindowMs: 600_000,
        maxRetryAttempts: 5,
        retryDelayMs: 100,
      })

      expect(delivery).toBeInstanceOf(ExactlyOnceChannelDelivery)
    })
  })
})
