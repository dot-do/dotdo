/**
 * BatchWriter Tests
 *
 * TDD tests for BatchWriter - a generic batched event writer with deduplication.
 *
 * BatchWriter provides:
 * - Batching with configurable size/time thresholds
 * - Deduplication using message IDs
 * - Flush on threshold or interval
 * - Error handling with retry logic
 *
 * @module db/primitives/batch-writer
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  BatchWriter,
  type BatchWriterOptions,
  type BatchItem,
  type FlushResult,
  type FlushHandler,
  createBatchWriter,
} from './index'

// ============================================================================
// TEST HELPERS
// ============================================================================

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createMockHandler(): FlushHandler<unknown> & {
  batches: unknown[][]
  callCount: number
} {
  const handler = {
    batches: [] as unknown[][],
    callCount: 0,
    async flush(items: unknown[]): Promise<FlushResult> {
      handler.batches.push([...items])
      handler.callCount++
      return { success: true, count: items.length }
    },
  }
  return handler
}

function createFailingHandler(
  failCount: number
): FlushHandler<unknown> & { attempts: number } {
  let attempts = 0
  return {
    get attempts() {
      return attempts
    },
    async flush(items: unknown[]): Promise<FlushResult> {
      attempts++
      if (attempts <= failCount) {
        throw new Error(`Simulated failure ${attempts}`)
      }
      return { success: true, count: items.length }
    },
  }
}

// ============================================================================
// BATCH WRITER - CREATION AND CONFIGURATION
// ============================================================================

describe('BatchWriter', () => {
  describe('creation', () => {
    it('should create with required options', () => {
      const handler = createMockHandler()
      const writer = createBatchWriter({ handler })
      expect(writer).toBeDefined()
    })

    it('should create with all options', () => {
      const handler = createMockHandler()
      const writer = createBatchWriter({
        handler,
        batchSize: 50,
        flushInterval: 5000,
        maxQueueSize: 10000,
        retries: 5,
        retryDelay: 200,
        retryBackoff: 'exponential',
        dedupWindow: 120000,
      })
      expect(writer.options.batchSize).toBe(50)
      expect(writer.options.flushInterval).toBe(5000)
      expect(writer.options.maxQueueSize).toBe(10000)
      expect(writer.options.retries).toBe(5)
      expect(writer.options.retryDelay).toBe(200)
      expect(writer.options.retryBackoff).toBe('exponential')
      expect(writer.options.dedupWindow).toBe(120000)
    })

    it('should use defaults for optional fields', () => {
      const handler = createMockHandler()
      const writer = createBatchWriter({ handler })
      expect(writer.options.batchSize).toBe(20) // default
      expect(writer.options.flushInterval).toBe(10000) // default 10s
      expect(writer.options.maxQueueSize).toBe(10000) // default
      expect(writer.options.retries).toBe(3) // default
      expect(writer.options.retryDelay).toBe(100) // default
      expect(writer.options.retryBackoff).toBe('exponential') // default
      expect(writer.options.dedupWindow).toBe(60000) // default 60s
    })

    it('should reject missing handler', () => {
      expect(() =>
        createBatchWriter({} as BatchWriterOptions<unknown>)
      ).toThrow('handler is required')
    })
  })

  describe('class instantiation', () => {
    it('should work with new keyword', () => {
      const handler = createMockHandler()
      const writer = new BatchWriter({ handler })
      expect(writer).toBeInstanceOf(BatchWriter)
    })
  })
})

// ============================================================================
// WRITE OPERATIONS - ADDING ITEMS TO BATCH
// ============================================================================

describe('Write Operations', () => {
  let writer: BatchWriter<{ id: string; data: unknown }>
  let handler: ReturnType<typeof createMockHandler>

  beforeEach(() => {
    handler = createMockHandler()
    writer = createBatchWriter({
      handler,
      batchSize: 100, // High threshold to prevent auto-flush
      flushInterval: 60000, // Long interval
    })
  })

  afterEach(async () => {
    await writer.close()
  })

  describe('basic writes', () => {
    it('should add item to queue', async () => {
      await writer.write({ id: 'msg_1', data: { value: 1 } })
      expect(writer.queueSize).toBe(1)
    })

    it('should add multiple items to queue', async () => {
      await writer.write({ id: 'msg_1', data: { value: 1 } })
      await writer.write({ id: 'msg_2', data: { value: 2 } })
      await writer.write({ id: 'msg_3', data: { value: 3 } })
      expect(writer.queueSize).toBe(3)
    })

    it('should support write with explicit message ID', async () => {
      await writer.write({ id: 'custom-id', data: 'test' }, 'custom-id')
      await writer.flush()
      expect(handler.batches[0][0]).toMatchObject({ id: 'custom-id' })
    })

    it('should use item.id as default message ID when available', async () => {
      await writer.write({ id: 'item-id', data: 'test' })
      await writer.write({ id: 'item-id', data: 'duplicate' }) // should be deduped
      expect(writer.queueSize).toBe(1)
    })

    it('should generate message ID when not provided', async () => {
      const writerNoId = createBatchWriter<{ data: string }>({
        handler,
        batchSize: 100,
      })
      await writerNoId.write({ data: 'no id item' })
      await writerNoId.flush()
      expect(handler.batches[0]).toHaveLength(1)
      await writerNoId.close()
    })
  })

  describe('queue management', () => {
    it('should report queue size', async () => {
      expect(writer.queueSize).toBe(0)
      await writer.write({ id: 'msg_1', data: 1 })
      expect(writer.queueSize).toBe(1)
      await writer.write({ id: 'msg_2', data: 2 })
      expect(writer.queueSize).toBe(2)
    })

    it('should clear queue after flush', async () => {
      await writer.write({ id: 'msg_1', data: 1 })
      await writer.write({ id: 'msg_2', data: 2 })
      expect(writer.queueSize).toBe(2)
      await writer.flush()
      expect(writer.queueSize).toBe(0)
    })

    it('should respect maxQueueSize by dropping oldest', async () => {
      const smallWriter = createBatchWriter<{ id: string; value: number }>({
        handler,
        batchSize: 100,
        maxQueueSize: 5,
        flushInterval: 60000,
      })

      for (let i = 0; i < 10; i++) {
        await smallWriter.write({ id: `msg_${i}`, value: i })
      }

      expect(smallWriter.queueSize).toBe(5)
      await smallWriter.flush()
      // Should have kept the 5 most recent items (5-9)
      const flushed = handler.batches[0] as { id: string; value: number }[]
      expect(flushed.map((item) => item.value)).toEqual([5, 6, 7, 8, 9])
      await smallWriter.close()
    })
  })
})

// ============================================================================
// DEDUPLICATION - MESSAGE ID BASED
// ============================================================================

describe('Deduplication', () => {
  let writer: BatchWriter<{ id: string; data: unknown }>
  let handler: ReturnType<typeof createMockHandler>

  beforeEach(() => {
    handler = createMockHandler()
    writer = createBatchWriter({
      handler,
      batchSize: 100,
      flushInterval: 60000,
      dedupWindow: 60000, // 60 second dedup window
    })
  })

  afterEach(async () => {
    await writer.close()
  })

  describe('basic deduplication', () => {
    it('should deduplicate by message ID', async () => {
      await writer.write({ id: 'msg_1', data: 'first' }, 'msg_1')
      await writer.write({ id: 'msg_1', data: 'duplicate' }, 'msg_1')
      await writer.write({ id: 'msg_2', data: 'different' }, 'msg_2')

      expect(writer.queueSize).toBe(2)
      await writer.flush()
      expect(handler.batches[0]).toHaveLength(2)
    })

    it('should track dedup by explicit message ID, not item.id', async () => {
      await writer.write({ id: 'item_1', data: 'first' }, 'dedup_key_1')
      await writer.write({ id: 'item_2', data: 'second' }, 'dedup_key_1') // Same dedup key
      await writer.write({ id: 'item_3', data: 'third' }, 'dedup_key_2')

      expect(writer.queueSize).toBe(2)
    })

    it('should keep first occurrence when deduplicating', async () => {
      await writer.write({ id: 'msg_1', data: 'FIRST' }, 'msg_1')
      await writer.write({ id: 'msg_1', data: 'SECOND' }, 'msg_1')

      await writer.flush()
      expect((handler.batches[0][0] as { data: string }).data).toBe('FIRST')
    })
  })

  describe('dedup window expiration', () => {
    it('should allow duplicate after window expires', async () => {
      vi.useFakeTimers()

      const shortWindowWriter = createBatchWriter<{ id: string; data: string }>(
        {
          handler,
          batchSize: 100,
          flushInterval: 600000,
          dedupWindow: 1000, // 1 second window
        }
      )

      await shortWindowWriter.write({ id: 'msg_1', data: 'first' }, 'msg_1')
      vi.advanceTimersByTime(2000) // Past dedup window
      await shortWindowWriter.write({ id: 'msg_1', data: 'second' }, 'msg_1')

      expect(shortWindowWriter.queueSize).toBe(2)

      await shortWindowWriter.close()
      vi.useRealTimers()
    })

    it('should not allow duplicate within window', async () => {
      vi.useFakeTimers()

      const shortWindowWriter = createBatchWriter<{ id: string; data: string }>(
        {
          handler,
          batchSize: 100,
          flushInterval: 600000,
          dedupWindow: 5000, // 5 second window
        }
      )

      await shortWindowWriter.write({ id: 'msg_1', data: 'first' }, 'msg_1')
      vi.advanceTimersByTime(2000) // Within dedup window
      await shortWindowWriter.write({ id: 'msg_1', data: 'duplicate' }, 'msg_1')

      expect(shortWindowWriter.queueSize).toBe(1)

      await shortWindowWriter.close()
      vi.useRealTimers()
    })
  })

  describe('dedup cache cleanup', () => {
    it('should clean up expired dedup entries', async () => {
      vi.useFakeTimers()

      const shortWindowWriter = createBatchWriter<{ id: string }>({
        handler,
        batchSize: 100,
        flushInterval: 600000,
        dedupWindow: 1000,
      })

      // Add many items
      for (let i = 0; i < 100; i++) {
        await shortWindowWriter.write({ id: `msg_${i}` }, `msg_${i}`)
      }

      // Advance past dedup window
      vi.advanceTimersByTime(2000)

      // Dedup cache should be cleaned on next write
      await shortWindowWriter.write({ id: 'new' }, 'new')

      // Verify dedup stats show cleanup happened
      const stats = shortWindowWriter.getStats()
      expect(stats.dedupCacheSize).toBeLessThan(100)

      await shortWindowWriter.close()
      vi.useRealTimers()
    })
  })
})

// ============================================================================
// BATCHING - SIZE AND TIME THRESHOLDS
// ============================================================================

describe('Batching', () => {
  let handler: ReturnType<typeof createMockHandler>

  beforeEach(() => {
    handler = createMockHandler()
  })

  describe('batch size threshold', () => {
    it('should auto-flush when batch size reached', async () => {
      const writer = createBatchWriter({
        handler,
        batchSize: 5,
        flushInterval: 60000,
      })

      for (let i = 0; i < 5; i++) {
        await writer.write({ id: `msg_${i}` })
      }

      // Should have auto-flushed
      await delay(10) // Allow async flush to complete
      expect(handler.callCount).toBe(1)
      expect(handler.batches[0]).toHaveLength(5)

      await writer.close()
    })

    it('should not flush before batch size reached', async () => {
      const writer = createBatchWriter({
        handler,
        batchSize: 10,
        flushInterval: 60000,
      })

      for (let i = 0; i < 5; i++) {
        await writer.write({ id: `msg_${i}` })
      }

      expect(handler.callCount).toBe(0)
      expect(writer.queueSize).toBe(5)

      await writer.close()
    })

    it('should trigger multiple flushes for many items', async () => {
      const writer = createBatchWriter({
        handler,
        batchSize: 3,
        flushInterval: 60000,
      })

      for (let i = 0; i < 10; i++) {
        await writer.write({ id: `msg_${i}` })
      }

      await delay(50) // Allow async flushes to complete
      expect(handler.callCount).toBe(3) // 3+3+3 = 9, 1 remaining
      expect(writer.queueSize).toBe(1) // 1 remaining

      await writer.close()
    })
  })

  describe('flush interval', () => {
    it('should auto-flush after interval', async () => {
      vi.useFakeTimers()

      const writer = createBatchWriter({
        handler,
        batchSize: 100,
        flushInterval: 1000,
      })

      await writer.write({ id: 'msg_1' })
      expect(handler.callCount).toBe(0)

      vi.advanceTimersByTime(1100)
      await Promise.resolve() // Allow flush to complete

      expect(handler.callCount).toBe(1)

      await writer.close()
      vi.useRealTimers()
    })

    it('should reset interval after manual flush', async () => {
      vi.useFakeTimers()

      const writer = createBatchWriter({
        handler,
        batchSize: 100,
        flushInterval: 1000,
      })

      await writer.write({ id: 'msg_1' })
      vi.advanceTimersByTime(500)
      await writer.flush() // Manual flush at 500ms
      expect(handler.callCount).toBe(1)

      await writer.write({ id: 'msg_2' })
      vi.advanceTimersByTime(500) // 1000ms total, but only 500ms since last flush
      await Promise.resolve()
      expect(handler.callCount).toBe(1) // Should not have flushed again yet

      vi.advanceTimersByTime(600) // Now past the interval
      await Promise.resolve()
      expect(handler.callCount).toBe(2)

      await writer.close()
      vi.useRealTimers()
    })

    it('should not flush empty queue on interval', async () => {
      vi.useFakeTimers()

      const writer = createBatchWriter({
        handler,
        batchSize: 100,
        flushInterval: 1000,
      })

      vi.advanceTimersByTime(1100)
      await Promise.resolve()

      expect(handler.callCount).toBe(0) // No flush on empty queue

      await writer.close()
      vi.useRealTimers()
    })
  })

  describe('manual flush', () => {
    it('should flush on demand', async () => {
      const writer = createBatchWriter({
        handler,
        batchSize: 100,
        flushInterval: 60000,
      })

      await writer.write({ id: 'msg_1' })
      await writer.write({ id: 'msg_2' })

      expect(handler.callCount).toBe(0)
      await writer.flush()
      expect(handler.callCount).toBe(1)
      expect(handler.batches[0]).toHaveLength(2)

      await writer.close()
    })

    it('should return flush result', async () => {
      const writer = createBatchWriter({
        handler,
        batchSize: 100,
      })

      await writer.write({ id: 'msg_1' })
      await writer.write({ id: 'msg_2' })

      const result = await writer.flush()

      expect(result).toMatchObject({
        success: true,
        count: 2,
      })

      await writer.close()
    })

    it('should handle flush of empty queue', async () => {
      const writer = createBatchWriter({
        handler,
        batchSize: 100,
      })

      const result = await writer.flush()

      expect(result).toMatchObject({
        success: true,
        count: 0,
      })
      expect(handler.callCount).toBe(0)

      await writer.close()
    })

    it('should prevent concurrent flushes', async () => {
      const slowHandler: FlushHandler<unknown> = {
        async flush(items) {
          await delay(100) // Slow handler
          return { success: true, count: items.length }
        },
      }

      const writer = createBatchWriter({
        handler: slowHandler,
        batchSize: 100,
      })

      await writer.write({ id: 'msg_1' })

      // Start two concurrent flushes
      const flush1 = writer.flush()
      const flush2 = writer.flush()

      const [result1, result2] = await Promise.all([flush1, flush2])

      // Both should return the same result (second waited for first)
      expect(result1.count).toBe(result2.count)

      await writer.close()
    })
  })
})

// ============================================================================
// ERROR HANDLING AND RETRY
// ============================================================================

describe('Error Handling and Retry', () => {
  describe('retry logic', () => {
    it('should retry failed flushes', async () => {
      const failingHandler = createFailingHandler(2) // Fail first 2 attempts

      const writer = createBatchWriter({
        handler: failingHandler,
        batchSize: 1,
        retries: 3,
        retryDelay: 10,
      })

      await writer.write({ id: 'msg_1' })
      const result = await writer.flush()

      expect(result.success).toBe(true)
      expect(failingHandler.attempts).toBe(3) // 2 failures + 1 success

      await writer.close()
    })

    it('should fail after max retries exhausted', async () => {
      const failingHandler = createFailingHandler(10) // Always fail

      const writer = createBatchWriter({
        handler: failingHandler,
        batchSize: 1,
        retries: 2, // 1 initial + 2 retries = 3 total attempts
        retryDelay: 10,
      })

      await writer.write({ id: 'msg_1' })
      const result = await writer.flush()

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(failingHandler.attempts).toBe(3)

      await writer.close()
    })

    it('should use exponential backoff', async () => {
      const delays: number[] = []
      let lastTime = Date.now()

      const timingHandler: FlushHandler<unknown> = {
        async flush() {
          const now = Date.now()
          delays.push(now - lastTime)
          lastTime = now
          throw new Error('Always fails')
        },
      }

      const writer = createBatchWriter({
        handler: timingHandler,
        batchSize: 1,
        retries: 4,
        retryDelay: 50,
        retryBackoff: 'exponential',
      })

      await writer.write({ id: 'msg_1' })
      await writer.flush()

      // Delays should roughly double: 0, 50, 100, 200, 400
      // First call is immediate (delays[0] ~= 0)
      expect(delays[1]).toBeGreaterThanOrEqual(45)
      expect(delays[2]).toBeGreaterThanOrEqual(90)
      expect(delays[3]).toBeGreaterThanOrEqual(180)

      await writer.close()
    })

    it('should use fixed backoff when configured', async () => {
      const delays: number[] = []
      let lastTime = Date.now()

      const timingHandler: FlushHandler<unknown> = {
        async flush() {
          const now = Date.now()
          delays.push(now - lastTime)
          lastTime = now
          throw new Error('Always fails')
        },
      }

      const writer = createBatchWriter({
        handler: timingHandler,
        batchSize: 1,
        retries: 3,
        retryDelay: 50,
        retryBackoff: 'fixed',
      })

      await writer.write({ id: 'msg_1' })
      await writer.flush()

      // Delays should be consistent (approximately 50ms each)
      expect(delays[1]).toBeGreaterThanOrEqual(45)
      expect(delays[1]).toBeLessThan(80)
      expect(delays[2]).toBeGreaterThanOrEqual(45)
      expect(delays[2]).toBeLessThan(80)

      await writer.close()
    })
  })

  describe('error callbacks', () => {
    it('should call onError callback on failure', async () => {
      const errors: Error[] = []
      const failingHandler = createFailingHandler(10)

      const writer = createBatchWriter({
        handler: failingHandler,
        batchSize: 1,
        retries: 0,
        onError: (error) => errors.push(error),
      })

      await writer.write({ id: 'msg_1' })
      await writer.flush()

      expect(errors).toHaveLength(1)
      expect(errors[0].message).toContain('Simulated failure')

      await writer.close()
    })

    it('should include failed items in error context', async () => {
      let errorContext: { items: unknown[]; error: Error } | undefined
      const failingHandler = createFailingHandler(10)

      const writer = createBatchWriter({
        handler: failingHandler,
        batchSize: 1,
        retries: 0,
        onError: (error, items) => {
          errorContext = { error, items }
        },
      })

      await writer.write({ id: 'msg_1', data: 'test' })
      await writer.flush()

      expect(errorContext).toBeDefined()
      expect(errorContext!.items).toHaveLength(1)
      expect(errorContext!.items[0]).toMatchObject({ id: 'msg_1' })

      await writer.close()
    })
  })

  describe('failed batch handling', () => {
    it('should requeue items on recoverable error when configured', async () => {
      let attempts = 0
      const handler: FlushHandler<unknown> = {
        async flush(items) {
          attempts++
          if (attempts === 1) {
            throw new Error('Temporary failure')
          }
          return { success: true, count: items.length }
        },
      }

      const writer = createBatchWriter({
        handler,
        batchSize: 100,
        retries: 0,
        requeueOnError: true,
      })

      await writer.write({ id: 'msg_1' })
      await writer.flush()

      // Items should be requeued after first failure
      expect(writer.queueSize).toBe(1)

      // Second flush should succeed
      const result = await writer.flush()
      expect(result.success).toBe(true)
      expect(writer.queueSize).toBe(0)

      await writer.close()
    })

    it('should drop items on error when requeue is disabled', async () => {
      const failingHandler = createFailingHandler(10)

      const writer = createBatchWriter({
        handler: failingHandler,
        batchSize: 100,
        retries: 0,
        requeueOnError: false, // default
      })

      await writer.write({ id: 'msg_1' })
      await writer.flush()

      expect(writer.queueSize).toBe(0) // Items dropped

      await writer.close()
    })
  })
})

// ============================================================================
// LIFECYCLE - CLOSE AND CLEANUP
// ============================================================================

describe('Lifecycle', () => {
  describe('close', () => {
    it('should flush pending items on close', async () => {
      const handler = createMockHandler()
      const writer = createBatchWriter({
        handler,
        batchSize: 100,
        flushInterval: 60000,
      })

      await writer.write({ id: 'msg_1' })
      await writer.write({ id: 'msg_2' })

      await writer.close()

      expect(handler.callCount).toBe(1)
      expect(handler.batches[0]).toHaveLength(2)
    })

    it('should reject new writes after close', async () => {
      const handler = createMockHandler()
      const writer = createBatchWriter({ handler })

      await writer.close()

      await expect(writer.write({ id: 'msg_1' })).rejects.toThrow(
        'BatchWriter is closed'
      )
    })

    it('should be idempotent', async () => {
      const handler = createMockHandler()
      const writer = createBatchWriter({
        handler,
        batchSize: 100,
      })

      await writer.write({ id: 'msg_1' })

      await writer.close()
      await writer.close() // Second close should be no-op

      expect(handler.callCount).toBe(1)
    })

    it('should stop flush interval timer', async () => {
      vi.useFakeTimers()

      const handler = createMockHandler()
      const writer = createBatchWriter({
        handler,
        batchSize: 100,
        flushInterval: 1000,
      })

      await writer.write({ id: 'msg_1' })
      await writer.close()

      // Clear handler batches to track new flushes
      const countAfterClose = handler.callCount

      // Advance time - should not trigger any more flushes
      vi.advanceTimersByTime(5000)
      await Promise.resolve()

      expect(handler.callCount).toBe(countAfterClose)

      vi.useRealTimers()
    })
  })

  describe('closed state', () => {
    it('should report closed status', async () => {
      const handler = createMockHandler()
      const writer = createBatchWriter({ handler })

      expect(writer.isClosed).toBe(false)
      await writer.close()
      expect(writer.isClosed).toBe(true)
    })

    it('should reject flush after close', async () => {
      const handler = createMockHandler()
      const writer = createBatchWriter({ handler })

      await writer.close()

      await expect(writer.flush()).rejects.toThrow('BatchWriter is closed')
    })
  })
})

// ============================================================================
// CALLBACKS AND EVENTS
// ============================================================================

describe('Callbacks', () => {
  describe('onFlush callback', () => {
    it('should call onFlush after successful flush', async () => {
      const results: FlushResult[] = []
      const handler = createMockHandler()
      const writer = createBatchWriter({
        handler,
        batchSize: 100,
        onFlush: (result) => results.push(result),
      })

      await writer.write({ id: 'msg_1' })
      await writer.write({ id: 'msg_2' })
      await writer.flush()

      expect(results).toHaveLength(1)
      expect(results[0]).toMatchObject({
        success: true,
        count: 2,
      })

      await writer.close()
    })

    it('should call onFlush even on empty flush', async () => {
      const results: FlushResult[] = []
      const handler = createMockHandler()
      const writer = createBatchWriter({
        handler,
        onFlush: (result) => results.push(result),
      })

      await writer.flush()

      expect(results).toHaveLength(1)
      expect(results[0]).toMatchObject({
        success: true,
        count: 0,
      })

      await writer.close()
    })
  })

  describe('onWrite callback', () => {
    it('should call onWrite for each write', async () => {
      const writes: unknown[] = []
      const handler = createMockHandler()
      const writer = createBatchWriter({
        handler,
        batchSize: 100,
        onWrite: (item) => writes.push(item),
      })

      await writer.write({ id: 'msg_1', data: 'first' })
      await writer.write({ id: 'msg_2', data: 'second' })

      expect(writes).toHaveLength(2)
      expect(writes[0]).toMatchObject({ id: 'msg_1' })
      expect(writes[1]).toMatchObject({ id: 'msg_2' })

      await writer.close()
    })

    it('should not call onWrite for deduplicated items', async () => {
      const writes: unknown[] = []
      const handler = createMockHandler()
      const writer = createBatchWriter({
        handler,
        batchSize: 100,
        onWrite: (item) => writes.push(item),
      })

      await writer.write({ id: 'msg_1' }, 'msg_1')
      await writer.write({ id: 'msg_1' }, 'msg_1') // Duplicate

      expect(writes).toHaveLength(1)

      await writer.close()
    })
  })
})

// ============================================================================
// STATISTICS AND MONITORING
// ============================================================================

describe('Statistics', () => {
  it('should track total writes', async () => {
    const handler = createMockHandler()
    const writer = createBatchWriter({
      handler,
      batchSize: 100,
    })

    await writer.write({ id: 'msg_1' })
    await writer.write({ id: 'msg_2' })
    await writer.write({ id: 'msg_3' })

    const stats = writer.getStats()
    expect(stats.totalWrites).toBe(3)

    await writer.close()
  })

  it('should track total flushes', async () => {
    const handler = createMockHandler()
    const writer = createBatchWriter({
      handler,
      batchSize: 2,
    })

    await writer.write({ id: 'msg_1' })
    await writer.write({ id: 'msg_2' }) // Auto-flush
    await delay(10)
    await writer.write({ id: 'msg_3' })
    await writer.flush() // Manual flush

    const stats = writer.getStats()
    expect(stats.totalFlushes).toBe(2)

    await writer.close()
  })

  it('should track deduplicated count', async () => {
    const handler = createMockHandler()
    const writer = createBatchWriter({
      handler,
      batchSize: 100,
    })

    await writer.write({ id: 'msg_1' }, 'msg_1')
    await writer.write({ id: 'msg_1' }, 'msg_1') // Duplicate
    await writer.write({ id: 'msg_2' }, 'msg_2')
    await writer.write({ id: 'msg_1' }, 'msg_1') // Duplicate

    const stats = writer.getStats()
    expect(stats.duplicatesDropped).toBe(2)

    await writer.close()
  })

  it('should track failed flushes', async () => {
    const failingHandler = createFailingHandler(10)
    const writer = createBatchWriter({
      handler: failingHandler,
      batchSize: 100,
      retries: 0,
    })

    await writer.write({ id: 'msg_1' })
    await writer.flush()
    await writer.write({ id: 'msg_2' })
    await writer.flush()

    const stats = writer.getStats()
    expect(stats.failedFlushes).toBe(2)

    await writer.close()
  })

  it('should track dedup cache size', async () => {
    const handler = createMockHandler()
    const writer = createBatchWriter({
      handler,
      batchSize: 100,
    })

    await writer.write({ id: 'msg_1' }, 'key_1')
    await writer.write({ id: 'msg_2' }, 'key_2')
    await writer.write({ id: 'msg_3' }, 'key_3')

    const stats = writer.getStats()
    expect(stats.dedupCacheSize).toBe(3)

    await writer.close()
  })

  it('should track items dropped due to queue overflow', async () => {
    const handler = createMockHandler()
    const writer = createBatchWriter({
      handler,
      batchSize: 100,
      maxQueueSize: 3,
      flushInterval: 60000,
    })

    for (let i = 0; i < 10; i++) {
      await writer.write({ id: `msg_${i}` })
    }

    const stats = writer.getStats()
    expect(stats.itemsDropped).toBe(7) // 10 - 3

    await writer.close()
  })
})

// ============================================================================
// TYPED BATCH WRITER
// ============================================================================

describe('Type Safety', () => {
  interface MyEvent {
    id: string
    type: 'click' | 'view' | 'purchase'
    timestamp: Date
    metadata?: Record<string, unknown>
  }

  it('should preserve type information', async () => {
    const batches: MyEvent[][] = []
    const handler: FlushHandler<MyEvent> = {
      async flush(items) {
        batches.push([...items])
        return { success: true, count: items.length }
      },
    }

    const writer = createBatchWriter<MyEvent>({
      handler,
      batchSize: 100,
    })

    await writer.write({
      id: 'evt_1',
      type: 'click',
      timestamp: new Date(),
    })

    await writer.flush()

    const event = batches[0][0]
    expect(event.type).toBe('click')
    expect(event.timestamp).toBeInstanceOf(Date)

    await writer.close()
  })
})
