/**
 * ExactlyOnceDelivery Tests
 *
 * Tests for exactly-once delivery guarantees including:
 * - Idempotency keys and deduplication
 * - Transaction logging
 * - Deduplication window
 * - Offset commit after successful processing
 * - Two-phase commit pattern
 * - Dead letter queue for failed events
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  ExactlyOnceDelivery,
  createExactlyOnceDelivery,
  type DeliveryEvent,
  type DeliveryResult,
  type ExactlyOnceDeliveryOptions,
  type ExactlyOnceCheckpointState,
} from '../exactly-once-delivery'

// ============================================================================
// TEST HELPERS
// ============================================================================

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createDelivery<T = unknown>(
  options?: ExactlyOnceDeliveryOptions<T>
): ExactlyOnceDelivery<T> {
  return createExactlyOnceDelivery<T>(options)
}

interface TestPayload {
  orderId: string
  amount: number
  status: string
}

// ============================================================================
// BASIC DELIVERY
// ============================================================================

describe('ExactlyOnceDelivery', () => {
  describe('basic delivery', () => {
    it('should deliver an event successfully', async () => {
      const processed: DeliveryEvent[] = []
      const delivery = createDelivery({
        onProcess: async (event) => {
          processed.push(event)
        },
      })

      const result = await delivery.deliver({
        idempotencyKey: 'order-123',
        payload: { orderId: '123', status: 'created' },
      })

      expect(result.success).toBe(true)
      expect(result.wasDuplicate).toBe(false)
      expect(result.status).toBe('committed')
      expect(processed).toHaveLength(1)
      expect(processed[0]!.idempotencyKey).toBe('order-123')
    })

    it('should deliver with offset and commit it', async () => {
      const committedOffsets: Array<{ value: number; partition?: string }> = []
      const delivery = createDelivery({
        onProcess: async () => {},
        onOffsetCommit: async (offset, partition) => {
          committedOffsets.push({ value: offset.value as number, partition })
        },
      })

      await delivery.deliver({
        idempotencyKey: 'order-456',
        payload: { orderId: '456' },
        offset: { value: 1000, format: 'numeric' },
      })

      expect(committedOffsets).toHaveLength(1)
      expect(committedOffsets[0]!.value).toBe(1000)
    })

    it('should set timestamp if not provided', async () => {
      let capturedEvent: DeliveryEvent | null = null
      const delivery = createDelivery({
        onProcess: async (event) => {
          capturedEvent = event
        },
      })

      const before = Date.now()
      await delivery.deliver({
        idempotencyKey: 'order-789',
        payload: {},
      })
      const after = Date.now()

      expect(capturedEvent).not.toBeNull()
      expect(capturedEvent!.timestamp).toBeGreaterThanOrEqual(before)
      expect(capturedEvent!.timestamp).toBeLessThanOrEqual(after)
    })

    it('should include metadata in delivery', async () => {
      let capturedEvent: DeliveryEvent | null = null
      const delivery = createDelivery({
        onProcess: async (event) => {
          capturedEvent = event
        },
      })

      await delivery.deliver({
        idempotencyKey: 'order-meta',
        payload: {},
        metadata: { source: 'test', version: 1 },
      })

      expect(capturedEvent!.metadata).toEqual({ source: 'test', version: 1 })
    })
  })

  // ============================================================================
  // IDEMPOTENCY AND DEDUPLICATION
  // ============================================================================

  describe('idempotency and deduplication', () => {
    it('should skip duplicate events with same idempotency key', async () => {
      const processed: string[] = []
      const delivery = createDelivery({
        onProcess: async (event) => {
          processed.push(event.idempotencyKey)
        },
      })

      const result1 = await delivery.deliver({
        idempotencyKey: 'order-dup',
        payload: { attempt: 1 },
      })

      const result2 = await delivery.deliver({
        idempotencyKey: 'order-dup',
        payload: { attempt: 2 },
      })

      expect(result1.success).toBe(true)
      expect(result1.wasDuplicate).toBe(false)
      expect(result2.success).toBe(true)
      expect(result2.wasDuplicate).toBe(true)
      expect(processed).toHaveLength(1)
    })

    it('should process different idempotency keys independently', async () => {
      const processed: string[] = []
      const delivery = createDelivery({
        onProcess: async (event) => {
          processed.push(event.idempotencyKey)
        },
      })

      await delivery.deliver({ idempotencyKey: 'order-1', payload: {} })
      await delivery.deliver({ idempotencyKey: 'order-2', payload: {} })
      await delivery.deliver({ idempotencyKey: 'order-3', payload: {} })

      expect(processed).toHaveLength(3)
      expect(processed).toContain('order-1')
      expect(processed).toContain('order-2')
      expect(processed).toContain('order-3')
    })

    it('should check isDuplicate correctly', async () => {
      const delivery = createDelivery({
        onProcess: async () => {},
      })

      expect(delivery.isDuplicate('order-check')).toBe(false)

      await delivery.deliver({ idempotencyKey: 'order-check', payload: {} })

      expect(delivery.isDuplicate('order-check')).toBe(true)
      expect(delivery.isDuplicate('order-other')).toBe(false)
    })

    it('should allow reprocessing after deduplication window expires', async () => {
      const processed: number[] = []
      const delivery = createDelivery({
        onProcess: async (event) => {
          processed.push(Date.now())
        },
        deduplicationWindowMs: 50, // Short window for testing
      })

      await delivery.deliver({ idempotencyKey: 'order-expire', payload: {} })
      expect(processed).toHaveLength(1)

      // Immediate retry should be skipped
      await delivery.deliver({ idempotencyKey: 'order-expire', payload: {} })
      expect(processed).toHaveLength(1)

      // Wait for window to expire
      await delay(100)

      // Should be processed again
      await delivery.deliver({ idempotencyKey: 'order-expire', payload: {} })
      expect(processed).toHaveLength(2)
    })

    it('should cleanup expired entries from deduplication cache', async () => {
      const delivery = createDelivery({
        onProcess: async () => {},
        deduplicationWindowMs: 50,
      })

      await delivery.deliver({ idempotencyKey: 'order-cleanup-1', payload: {} })
      await delivery.deliver({ idempotencyKey: 'order-cleanup-2', payload: {} })

      expect(delivery.getStats().deduplicationCacheSize).toBe(2)

      await delay(100)

      const cleaned = delivery.cleanupDeduplicationCache()
      expect(cleaned).toBe(2)
      expect(delivery.getStats().deduplicationCacheSize).toBe(0)
    })

    it('should handle concurrent delivery of same key', async () => {
      let processCount = 0
      const delivery = createDelivery({
        onProcess: async () => {
          processCount++
          await delay(50) // Simulate slow processing
        },
      })

      // Start two concurrent deliveries with same key
      const [result1, result2] = await Promise.all([
        delivery.deliver({ idempotencyKey: 'concurrent-key', payload: { n: 1 } }),
        delivery.deliver({ idempotencyKey: 'concurrent-key', payload: { n: 2 } }),
      ])

      // Only one should have been processed
      expect(processCount).toBe(1)
      // Both should return same result
      expect(result1.idempotencyKey).toBe(result2.idempotencyKey)
    })
  })

  // ============================================================================
  // RETRIES AND FAILURE HANDLING
  // ============================================================================

  describe('retries and failure handling', () => {
    it('should retry on failure', async () => {
      let attempts = 0
      const delivery = createDelivery({
        onProcess: async () => {
          attempts++
          if (attempts < 3) {
            throw new Error(`Attempt ${attempts} failed`)
          }
        },
        maxRetryAttempts: 3,
        retryDelayMs: 10,
      })

      const result = await delivery.deliver({
        idempotencyKey: 'order-retry',
        payload: {},
      })

      expect(result.success).toBe(true)
      expect(attempts).toBe(3)
    })

    it('should move to DLQ after max retries', async () => {
      const delivery = createDelivery({
        onProcess: async () => {
          throw new Error('Always fails')
        },
        maxRetryAttempts: 2,
        retryDelayMs: 10,
      })

      const result = await delivery.deliver({
        idempotencyKey: 'order-dlq',
        payload: { important: true },
      })

      expect(result.success).toBe(false)
      expect(result.status).toBe('dead_lettered')
      expect(delivery.getDeadLetterCount()).toBe(1)

      const dlqEntries = delivery.getDeadLetterQueue()
      expect(dlqEntries[0]!.idempotencyKey).toBe('order-dlq')
      expect(dlqEntries[0]!.attempts).toBe(2)
    })

    it('should record attempt history in DLQ', async () => {
      const delivery = createDelivery({
        onProcess: async () => {
          throw new Error('Permanent failure')
        },
        maxRetryAttempts: 3,
        retryDelayMs: 10,
      })

      await delivery.deliver({
        idempotencyKey: 'order-history',
        payload: {},
      })

      const dlq = delivery.getDeadLetterQueue()
      expect(dlq[0]!.attemptHistory).toHaveLength(3)
      expect(dlq[0]!.attemptHistory[0]!.error).toBe('Permanent failure')
    })

    it('should use exponential backoff for retries', async () => {
      const timestamps: number[] = []
      const delivery = createDelivery({
        onProcess: async () => {
          timestamps.push(Date.now())
          if (timestamps.length < 3) {
            throw new Error('Retry needed')
          }
        },
        maxRetryAttempts: 3,
        retryDelayMs: 20,
        retryBackoffMultiplier: 2,
      })

      await delivery.deliver({ idempotencyKey: 'order-backoff', payload: {} })

      expect(timestamps).toHaveLength(3)
      // Second attempt should be delayed by ~20ms
      const delay1 = timestamps[1]! - timestamps[0]!
      // Third attempt should be delayed by ~40ms
      const delay2 = timestamps[2]! - timestamps[1]!

      expect(delay1).toBeGreaterThanOrEqual(15) // Allow some variance
      expect(delay2).toBeGreaterThanOrEqual(30)
    })

    it('should notify DLQ handler', async () => {
      const dlqEvents: string[] = []
      const delivery = createDelivery({
        onProcess: async () => {
          throw new Error('Failed')
        },
        onDeadLetter: async (entry) => {
          dlqEvents.push(entry.idempotencyKey)
        },
        maxRetryAttempts: 1,
      })

      await delivery.deliver({ idempotencyKey: 'order-notify', payload: {} })

      expect(dlqEvents).toContain('order-notify')
    })
  })

  // ============================================================================
  // TWO-PHASE COMMIT
  // ============================================================================

  describe('two-phase commit', () => {
    it('should prepare a transaction', async () => {
      const delivery = createDelivery<TestPayload>({
        onProcess: async () => {},
      })

      const txId = await delivery.prepare({
        idempotencyKey: 'order-2pc',
        payload: { orderId: '123', amount: 100, status: 'pending' },
      })

      expect(txId).toBeDefined()
      expect(txId.startsWith('tx-')).toBe(true)

      const prepared = delivery.getPreparedTransaction(txId)
      expect(prepared).toBeDefined()
      expect(prepared!.status).toBe('prepared')
    })

    it('should commit a prepared transaction', async () => {
      const processed: string[] = []
      const delivery = createDelivery({
        onProcess: async (event) => {
          processed.push(event.idempotencyKey)
        },
      })

      const txId = await delivery.prepare({
        idempotencyKey: 'order-commit',
        payload: {},
      })

      const result = await delivery.commit(txId)

      expect(result.success).toBe(true)
      expect(result.transactionId).toBe(txId)
      expect(processed).toContain('order-commit')

      // Should be removed from prepared transactions
      expect(delivery.getPreparedTransaction(txId)).toBeUndefined()
    })

    it('should rollback a prepared transaction', async () => {
      const processed: string[] = []
      const delivery = createDelivery({
        onProcess: async (event) => {
          processed.push(event.idempotencyKey)
        },
      })

      const txId = await delivery.prepare({
        idempotencyKey: 'order-rollback',
        payload: {},
      })

      await delivery.rollback(txId, 'Coordinator abort')

      // Should not have been processed
      expect(processed).not.toContain('order-rollback')

      // Should be removed from prepared transactions
      expect(delivery.getPreparedTransaction(txId)).toBeUndefined()
    })

    it('should reject duplicate prepare with same idempotency key', async () => {
      const delivery = createDelivery({
        onProcess: async () => {},
      })

      // First deliver normally
      await delivery.deliver({ idempotencyKey: 'order-dup-prepare', payload: {} })

      // Prepare with same key should fail
      await expect(
        delivery.prepare({ idempotencyKey: 'order-dup-prepare', payload: {} })
      ).rejects.toThrow('Duplicate idempotency key')
    })

    it('should timeout prepared transactions', async () => {
      const delivery = createDelivery({
        onProcess: async () => {},
        twoPhaseCommitTimeoutMs: 50,
      })

      const txId = await delivery.prepare({
        idempotencyKey: 'order-timeout',
        payload: {},
      })

      await delay(100)

      await expect(delivery.commit(txId)).rejects.toThrow('timed out')
    })

    it('should abort timed out transactions', async () => {
      const delivery = createDelivery({
        onProcess: async () => {},
        twoPhaseCommitTimeoutMs: 50,
      })

      await delivery.prepare({ idempotencyKey: 'order-abort-1', payload: {} })
      await delivery.prepare({ idempotencyKey: 'order-abort-2', payload: {} })

      expect(delivery.getAllPreparedTransactions()).toHaveLength(2)

      await delay(100)

      const aborted = await delivery.abortTimedOutTransactions()

      expect(aborted).toBe(2)
      expect(delivery.getAllPreparedTransactions()).toHaveLength(0)
    })

    it('should track participants in 2PC', async () => {
      const delivery = createDelivery({
        onProcess: async () => {},
      })

      const txId = await delivery.prepare(
        { idempotencyKey: 'order-participants', payload: {} },
        { participants: ['orders', 'payments', 'inventory'] }
      )

      const prepared = delivery.getPreparedTransaction(txId)
      expect(prepared!.participants).toEqual(['orders', 'payments', 'inventory'])
    })
  })

  // ============================================================================
  // TRANSACTION LOGGING
  // ============================================================================

  describe('transaction logging', () => {
    it('should log delivery operations', async () => {
      const delivery = createDelivery({
        onProcess: async () => {},
        enableTransactionLogging: true,
      })

      await delivery.deliver({
        idempotencyKey: 'order-log',
        payload: {},
        offset: { value: 100, format: 'numeric' },
      })

      const log = delivery.getTransactionLog()
      expect(log.length).toBeGreaterThanOrEqual(2)

      const types = log.map((e) => e.type)
      expect(types).toContain('PREPARE')
      expect(types).toContain('COMMIT')
    })

    it('should log rollback on failure', async () => {
      const delivery = createDelivery({
        onProcess: async () => {
          throw new Error('Failed')
        },
        enableTransactionLogging: true,
        maxRetryAttempts: 1,
      })

      await delivery.deliver({ idempotencyKey: 'order-fail-log', payload: {} })

      const log = delivery.getTransactionLog()
      const types = log.map((e) => e.type)
      expect(types).toContain('ROLLBACK')
      expect(types).toContain('DLQ_ENTRY')
    })

    it('should filter log by idempotency key', async () => {
      const delivery = createDelivery({
        onProcess: async () => {},
        enableTransactionLogging: true,
      })

      await delivery.deliver({ idempotencyKey: 'order-a', payload: {} })
      await delivery.deliver({ idempotencyKey: 'order-b', payload: {} })

      const logA = delivery.getTransactionLogForKey('order-a')
      expect(logA.every((e) => e.idempotencyKey === 'order-a')).toBe(true)
    })

    it('should trim transaction log when exceeds max size', async () => {
      const delivery = createDelivery({
        onProcess: async () => {},
        enableTransactionLogging: true,
        maxTransactionLogSize: 10,
      })

      // Create more entries than max
      for (let i = 0; i < 20; i++) {
        await delivery.deliver({ idempotencyKey: `order-trim-${i}`, payload: {} })
      }

      expect(delivery.getTransactionLog().length).toBeLessThanOrEqual(10)
    })

    it('should clear transaction log', async () => {
      const delivery = createDelivery({
        onProcess: async () => {},
        enableTransactionLogging: true,
      })

      await delivery.deliver({ idempotencyKey: 'order-clear', payload: {} })
      expect(delivery.getTransactionLog().length).toBeGreaterThan(0)

      delivery.clearTransactionLog()
      expect(delivery.getTransactionLog()).toHaveLength(0)
    })
  })

  // ============================================================================
  // OFFSET MANAGEMENT
  // ============================================================================

  describe('offset management', () => {
    it('should track committed offsets', async () => {
      const delivery = createDelivery({
        onProcess: async () => {},
      })

      await delivery.deliver({
        idempotencyKey: 'order-offset-1',
        payload: {},
        offset: { value: 100, format: 'numeric' },
      })

      await delivery.deliver({
        idempotencyKey: 'order-offset-2',
        payload: {},
        offset: { value: 200, format: 'numeric' },
      })

      const offset = delivery.getCommittedOffset()
      expect(offset).toEqual({ value: 200, format: 'numeric' })
    })

    it('should track offsets per partition', async () => {
      const delivery = createDelivery({
        onProcess: async () => {},
      })

      await delivery.deliver({
        idempotencyKey: 'order-p0',
        payload: {},
        offset: { value: 100, format: 'numeric' },
        partition: 'partition-0',
      })

      await delivery.deliver({
        idempotencyKey: 'order-p1',
        payload: {},
        offset: { value: 50, format: 'numeric' },
        partition: 'partition-1',
      })

      const offsets = delivery.getAllCommittedOffsets()
      expect(offsets.get('partition-0')!.value).toBe(100)
      expect(offsets.get('partition-1')!.value).toBe(50)
    })

    it('should call offset commit handler', async () => {
      const commits: Array<{ value: number; partition?: string }> = []
      const delivery = createDelivery({
        onProcess: async () => {},
        onOffsetCommit: async (offset, partition) => {
          commits.push({ value: offset.value as number, partition })
        },
      })

      await delivery.deliver({
        idempotencyKey: 'order-commit-handler',
        payload: {},
        offset: { value: 999, format: 'numeric' },
        partition: 'my-partition',
      })

      expect(commits).toHaveLength(1)
      expect(commits[0]!.value).toBe(999)
      expect(commits[0]!.partition).toBe('my-partition')
    })
  })

  // ============================================================================
  // DEAD LETTER QUEUE
  // ============================================================================

  describe('dead letter queue', () => {
    it('should replay from DLQ', async () => {
      let shouldFail = true
      const delivery = createDelivery({
        onProcess: async () => {
          if (shouldFail) {
            throw new Error('Temporary failure')
          }
        },
        maxRetryAttempts: 1,
      })

      await delivery.deliver({ idempotencyKey: 'order-replay', payload: {} })
      expect(delivery.getDeadLetterCount()).toBe(1)

      const dlqEntry = delivery.getDeadLetterQueue()[0]!
      shouldFail = false

      const result = await delivery.replayFromDeadLetter(dlqEntry.id)

      expect(result.success).toBe(true)
      expect(delivery.getDeadLetterCount()).toBe(0)
    })

    it('should replay all from DLQ', async () => {
      let failCount = 0
      const delivery = createDelivery({
        onProcess: async () => {
          failCount++
          if (failCount <= 3) {
            throw new Error('Fail')
          }
        },
        maxRetryAttempts: 1,
      })

      // Create 3 DLQ entries
      await delivery.deliver({ idempotencyKey: 'order-all-1', payload: {} })
      await delivery.deliver({ idempotencyKey: 'order-all-2', payload: {} })
      await delivery.deliver({ idempotencyKey: 'order-all-3', payload: {} })

      expect(delivery.getDeadLetterCount()).toBe(3)

      const result = await delivery.replayAllFromDeadLetter()

      expect(result.successful).toBe(3)
      expect(result.failed).toBe(0)
      expect(delivery.getDeadLetterCount()).toBe(0)
    })

    it('should remove DLQ entry manually', async () => {
      const delivery = createDelivery({
        onProcess: async () => {
          throw new Error('Fail')
        },
        maxRetryAttempts: 1,
      })

      await delivery.deliver({ idempotencyKey: 'order-remove', payload: {} })
      const dlqEntry = delivery.getDeadLetterQueue()[0]!

      const removed = delivery.removeFromDeadLetter(dlqEntry.id)

      expect(removed).toBe(true)
      expect(delivery.getDeadLetterCount()).toBe(0)
    })

    it('should clear DLQ', async () => {
      const delivery = createDelivery({
        onProcess: async () => {
          throw new Error('Fail')
        },
        maxRetryAttempts: 1,
      })

      await delivery.deliver({ idempotencyKey: 'order-clear-1', payload: {} })
      await delivery.deliver({ idempotencyKey: 'order-clear-2', payload: {} })

      delivery.clearDeadLetterQueue()

      expect(delivery.getDeadLetterCount()).toBe(0)
    })

    it('should trim DLQ when exceeds max size', async () => {
      const delivery = createDelivery({
        onProcess: async () => {
          throw new Error('Fail')
        },
        maxRetryAttempts: 1,
        maxDeadLetterQueueSize: 5,
      })

      for (let i = 0; i < 10; i++) {
        await delivery.deliver({ idempotencyKey: `order-trim-dlq-${i}`, payload: {} })
      }

      expect(delivery.getDeadLetterCount()).toBe(5)
    })
  })

  // ============================================================================
  // CHECKPOINT AND RECOVERY
  // ============================================================================

  describe('checkpoint and recovery', () => {
    it('should capture checkpoint state', async () => {
      const delivery = createDelivery({
        onProcess: async () => {},
      })

      await delivery.deliver({
        idempotencyKey: 'order-ckpt-1',
        payload: {},
        offset: { value: 100, format: 'numeric' },
      })

      const state = delivery.getCheckpointState()

      expect(state.version).toBe(1)
      expect(state.processedKeys.has('order-ckpt-1')).toBe(true)
      expect(state.committedOffsets.get('__default__')!.value).toBe(100)
    })

    it('should restore from checkpoint', async () => {
      const delivery = createDelivery({
        onProcess: async () => {},
        deduplicationWindowMs: 60_000,
      })

      const state: ExactlyOnceCheckpointState = {
        committedOffsets: new Map([['__default__', { value: 500, format: 'numeric' }]]),
        processedKeys: new Map([
          ['order-restored-1', Date.now()],
          ['order-restored-2', Date.now()],
        ]),
        transactionLog: [],
        preparedTransactions: new Map(),
        deadLetterQueue: [],
        checkpointedAt: Date.now(),
        version: 1,
      }

      delivery.restoreFromCheckpoint(state)

      // Should recognize restored keys as duplicates
      expect(delivery.isDuplicate('order-restored-1')).toBe(true)
      expect(delivery.isDuplicate('order-restored-2')).toBe(true)
      expect(delivery.isDuplicate('order-new')).toBe(false)

      // Should have restored offset
      expect(delivery.getCommittedOffset()!.value).toBe(500)
    })

    it('should filter expired keys during restore', async () => {
      const delivery = createDelivery({
        onProcess: async () => {},
        deduplicationWindowMs: 100,
      })

      const state: ExactlyOnceCheckpointState = {
        committedOffsets: new Map(),
        processedKeys: new Map([
          ['order-expired', Date.now() - 200], // Expired
          ['order-valid', Date.now()], // Valid
        ]),
        transactionLog: [],
        preparedTransactions: new Map(),
        deadLetterQueue: [],
        checkpointedAt: Date.now(),
        version: 1,
      }

      delivery.restoreFromCheckpoint(state)

      expect(delivery.isDuplicate('order-expired')).toBe(false)
      expect(delivery.isDuplicate('order-valid')).toBe(true)
    })

    it('should reject invalid checkpoint version', async () => {
      const delivery = createDelivery({})

      const state: ExactlyOnceCheckpointState = {
        committedOffsets: new Map(),
        processedKeys: new Map(),
        transactionLog: [],
        preparedTransactions: new Map(),
        deadLetterQueue: [],
        checkpointedAt: Date.now(),
        version: 99, // Invalid version
      }

      expect(() => delivery.restoreFromCheckpoint(state)).toThrow('Unsupported checkpoint version')
    })

    it('should restore DLQ entries', async () => {
      const delivery = createDelivery({})

      const state: ExactlyOnceCheckpointState = {
        committedOffsets: new Map(),
        processedKeys: new Map(),
        transactionLog: [],
        preparedTransactions: new Map(),
        deadLetterQueue: [
          {
            id: 'dlq-1',
            idempotencyKey: 'order-dlq-restored',
            event: { idempotencyKey: 'order-dlq-restored', payload: {} },
            error: 'Original error',
            attempts: 3,
            deadLetteredAt: Date.now(),
            attemptHistory: [],
          },
        ],
        checkpointedAt: Date.now(),
        version: 1,
      }

      delivery.restoreFromCheckpoint(state)

      expect(delivery.getDeadLetterCount()).toBe(1)
      expect(delivery.getDeadLetterQueue()[0]!.idempotencyKey).toBe('order-dlq-restored')
    })
  })

  // ============================================================================
  // BATCH DELIVERY
  // ============================================================================

  describe('batch delivery', () => {
    it('should deliver batch of events', async () => {
      const processed: string[] = []
      const delivery = createDelivery({
        onProcess: async (event) => {
          processed.push(event.idempotencyKey)
        },
      })

      const events: DeliveryEvent[] = [
        { idempotencyKey: 'batch-1', payload: {} },
        { idempotencyKey: 'batch-2', payload: {} },
        { idempotencyKey: 'batch-3', payload: {} },
      ]

      const results = await delivery.deliverBatch(events)

      expect(results).toHaveLength(3)
      expect(results.every((r) => r.success)).toBe(true)
      expect(processed).toHaveLength(3)
    })

    it('should maintain order in batch', async () => {
      const order: string[] = []
      const delivery = createDelivery({
        onProcess: async (event) => {
          order.push(event.idempotencyKey)
        },
      })

      const events: DeliveryEvent[] = [
        { idempotencyKey: 'first', payload: {} },
        { idempotencyKey: 'second', payload: {} },
        { idempotencyKey: 'third', payload: {} },
      ]

      await delivery.deliverBatch(events)

      expect(order).toEqual(['first', 'second', 'third'])
    })

    it('should handle partial batch failures', async () => {
      let count = 0
      const delivery = createDelivery({
        onProcess: async () => {
          count++
          if (count === 2) {
            throw new Error('Second event fails')
          }
        },
        maxRetryAttempts: 1,
      })

      const events: DeliveryEvent[] = [
        { idempotencyKey: 'ok-1', payload: {} },
        { idempotencyKey: 'fail', payload: {} },
        { idempotencyKey: 'ok-2', payload: {} },
      ]

      const results = await delivery.deliverBatch(events)

      expect(results[0]!.success).toBe(true)
      expect(results[1]!.success).toBe(false)
      expect(results[2]!.success).toBe(true)
    })
  })

  // ============================================================================
  // STATISTICS
  // ============================================================================

  describe('statistics', () => {
    it('should track processing stats', async () => {
      const delivery = createDelivery({
        onProcess: async () => {},
      })

      await delivery.deliver({ idempotencyKey: 'stat-1', payload: {} })
      await delivery.deliver({ idempotencyKey: 'stat-2', payload: {} })
      await delivery.deliver({ idempotencyKey: 'stat-1', payload: {} }) // Duplicate

      const stats = delivery.getStats()

      expect(stats.totalProcessed).toBe(2)
      expect(stats.duplicatesSkipped).toBe(1)
    })

    it('should track failure stats', async () => {
      const delivery = createDelivery({
        onProcess: async () => {
          throw new Error('Fail')
        },
        maxRetryAttempts: 1,
      })

      await delivery.deliver({ idempotencyKey: 'fail-stat', payload: {} })

      const stats = delivery.getStats()

      expect(stats.totalFailed).toBe(1)
      expect(stats.deadLetterCount).toBe(1)
    })

    it('should calculate average latency', async () => {
      const delivery = createDelivery({
        onProcess: async () => {
          await delay(10)
        },
      })

      await delivery.deliver({ idempotencyKey: 'latency-1', payload: {} })
      await delivery.deliver({ idempotencyKey: 'latency-2', payload: {} })

      const stats = delivery.getStats()

      expect(stats.avgProcessingLatencyMs).toBeGreaterThan(10)
    })
  })

  // ============================================================================
  // LIFECYCLE
  // ============================================================================

  describe('lifecycle', () => {
    it('should clear all state', async () => {
      const delivery = createDelivery({
        onProcess: async () => {},
      })

      await delivery.deliver({
        idempotencyKey: 'clear-test',
        payload: {},
        offset: { value: 100, format: 'numeric' },
      })

      delivery.clear()

      expect(delivery.isDuplicate('clear-test')).toBe(false)
      expect(delivery.getCommittedOffset()).toBeNull()
      expect(delivery.getTransactionLog()).toHaveLength(0)
      expect(delivery.getStats().totalProcessed).toBe(0)
    })
  })

  // ============================================================================
  // FACTORY FUNCTION
  // ============================================================================

  describe('factory function', () => {
    it('should create an ExactlyOnceDelivery instance', () => {
      const delivery = createExactlyOnceDelivery()
      expect(delivery).toBeInstanceOf(ExactlyOnceDelivery)
    })

    it('should accept configuration options', () => {
      const delivery = createExactlyOnceDelivery({
        deduplicationWindowMs: 600_000,
        maxRetryAttempts: 5,
        twoPhaseCommitTimeoutMs: 60_000,
      })

      expect(delivery).toBeInstanceOf(ExactlyOnceDelivery)
    })
  })
})
