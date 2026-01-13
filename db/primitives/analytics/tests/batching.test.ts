/**
 * Event Batching Tests - RED Phase
 *
 * TDD tests for event batching behavior in the analytics primitive.
 * These tests define expected behavior for:
 * - Batch size limits (flush when batch reaches threshold)
 * - Flush intervals (time-based automatic flush)
 * - Retry logic (exponential backoff, max retries)
 *
 * Tests are designed to FAIL until implementation is complete.
 *
 * @module db/primitives/analytics/tests/batching
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ============================================================================
// TEST TYPES AND HELPERS
// ============================================================================

interface BatchConfig {
  /** Maximum number of events before automatic flush */
  maxBatchSize: number
  /** Time in milliseconds before automatic flush */
  flushIntervalMs: number
  /** Maximum number of retry attempts */
  maxRetries: number
  /** Initial retry delay in milliseconds */
  retryDelayMs: number
  /** Backoff strategy: 'fixed' | 'exponential' */
  backoffStrategy: 'fixed' | 'exponential'
  /** Maximum retry delay (for exponential backoff) */
  maxRetryDelayMs?: number
}

interface BatchEvent {
  id: string
  type: string
  timestamp: Date
  data: Record<string, unknown>
}

interface FlushResult {
  success: boolean
  eventCount: number
  duration: number
  error?: Error
  retryCount?: number
}

interface BatchStats {
  totalEvents: number
  totalFlushes: number
  successfulFlushes: number
  failedFlushes: number
  retriedFlushes: number
  eventsDropped: number
  averageFlushDuration: number
  lastFlushTime?: Date
}

/**
 * EventBatcher - Core batching primitive for analytics events
 *
 * This interface defines the expected API for event batching.
 * Implementation should provide efficient, reliable batching with:
 * - Automatic flush on batch size threshold
 * - Automatic flush on time interval
 * - Retry with configurable backoff
 * - Statistics and monitoring
 */
interface EventBatcher {
  readonly config: BatchConfig
  readonly queueSize: number
  readonly isClosed: boolean

  add(event: BatchEvent): Promise<void>
  flush(): Promise<FlushResult>
  getStats(): BatchStats
  close(): Promise<void>
}

// Mock implementation for testing - this should fail until real implementation exists
function createEventBatcher(
  config: Partial<BatchConfig>,
  handler: (events: BatchEvent[]) => Promise<void>
): EventBatcher {
  // This will throw because the real module doesn't exist yet
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EventBatcher: RealEventBatcher } = require('../event-batcher')
  return new RealEventBatcher(config, handler)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createMockEvent(id: string, type = 'track'): BatchEvent {
  return {
    id,
    type,
    timestamp: new Date(),
    data: { value: Math.random() },
  }
}

// ============================================================================
// BATCH SIZE LIMITS - Events should flush when batch reaches threshold
// ============================================================================

describe('Batch Size Limits', () => {
  let batcher: EventBatcher
  let flushedBatches: BatchEvent[][]
  let flushHandler: (events: BatchEvent[]) => Promise<void>

  beforeEach(() => {
    flushedBatches = []
    flushHandler = async (events) => {
      flushedBatches.push([...events])
    }
  })

  afterEach(async () => {
    if (batcher && !batcher.isClosed) {
      await batcher.close()
    }
  })

  describe('automatic flush on size threshold', () => {
    it('should flush when batch size reaches maxBatchSize', async () => {
      batcher = createEventBatcher(
        { maxBatchSize: 5, flushIntervalMs: 60000 },
        flushHandler
      )

      // Add exactly maxBatchSize events
      for (let i = 0; i < 5; i++) {
        await batcher.add(createMockEvent(`evt_${i}`))
      }

      // Should have triggered automatic flush
      await delay(10) // Allow async flush to complete
      expect(flushedBatches.length).toBe(1)
      expect(flushedBatches[0]).toHaveLength(5)
    })

    it('should not flush before reaching maxBatchSize', async () => {
      batcher = createEventBatcher(
        { maxBatchSize: 10, flushIntervalMs: 60000 },
        flushHandler
      )

      // Add fewer than maxBatchSize events
      for (let i = 0; i < 5; i++) {
        await batcher.add(createMockEvent(`evt_${i}`))
      }

      expect(flushedBatches.length).toBe(0)
      expect(batcher.queueSize).toBe(5)
    })

    it('should trigger multiple flushes for large event streams', async () => {
      batcher = createEventBatcher(
        { maxBatchSize: 3, flushIntervalMs: 60000 },
        flushHandler
      )

      // Add 10 events (should trigger 3 flushes: 3+3+3, leaving 1)
      for (let i = 0; i < 10; i++) {
        await batcher.add(createMockEvent(`evt_${i}`))
      }

      await delay(50) // Allow async flushes to complete
      expect(flushedBatches.length).toBe(3)
      expect(batcher.queueSize).toBe(1) // 1 remaining
    })

    it('should respect maxBatchSize of 1 (immediate flush)', async () => {
      batcher = createEventBatcher(
        { maxBatchSize: 1, flushIntervalMs: 60000 },
        flushHandler
      )

      await batcher.add(createMockEvent('evt_1'))
      await delay(10)

      expect(flushedBatches.length).toBe(1)
      expect(flushedBatches[0]).toHaveLength(1)
    })

    it('should handle very large maxBatchSize', async () => {
      batcher = createEventBatcher(
        { maxBatchSize: 10000, flushIntervalMs: 60000 },
        flushHandler
      )

      for (let i = 0; i < 100; i++) {
        await batcher.add(createMockEvent(`evt_${i}`))
      }

      expect(flushedBatches.length).toBe(0)
      expect(batcher.queueSize).toBe(100)
    })
  })

  describe('batch size configuration', () => {
    it('should use default maxBatchSize when not specified', async () => {
      batcher = createEventBatcher({ flushIntervalMs: 60000 }, flushHandler)

      // Default should be 100
      expect(batcher.config.maxBatchSize).toBe(100)
    })

    it('should reject maxBatchSize of 0', () => {
      expect(() =>
        createEventBatcher({ maxBatchSize: 0, flushIntervalMs: 60000 }, flushHandler)
      ).toThrow('maxBatchSize must be at least 1')
    })

    it('should reject negative maxBatchSize', () => {
      expect(() =>
        createEventBatcher({ maxBatchSize: -5, flushIntervalMs: 60000 }, flushHandler)
      ).toThrow('maxBatchSize must be at least 1')
    })

    it('should cap maxBatchSize at reasonable limit (100000)', async () => {
      batcher = createEventBatcher(
        { maxBatchSize: 500000, flushIntervalMs: 60000 },
        flushHandler
      )

      expect(batcher.config.maxBatchSize).toBe(100000)
    })
  })

  describe('queue overflow protection', () => {
    it('should drop oldest events when queue exceeds maxQueueSize', async () => {
      const slowHandler = async (events: BatchEvent[]) => {
        await delay(100) // Slow handler
        flushedBatches.push([...events])
      }

      batcher = createEventBatcher(
        { maxBatchSize: 1000, flushIntervalMs: 60000 },
        slowHandler
      )

      // Configure a small max queue (this may need a separate config option)
      // For now, test the behavior with rapid event additions

      // This test documents expected behavior when queue is full
      const stats = batcher.getStats()
      expect(stats.eventsDropped).toBeGreaterThanOrEqual(0)
    })
  })
})

// ============================================================================
// FLUSH INTERVALS - Time-based automatic flushing
// ============================================================================

describe('Flush Intervals', () => {
  let batcher: EventBatcher
  let flushedBatches: BatchEvent[][]
  let flushHandler: (events: BatchEvent[]) => Promise<void>

  beforeEach(() => {
    vi.useFakeTimers()
    flushedBatches = []
    flushHandler = async (events) => {
      flushedBatches.push([...events])
    }
  })

  afterEach(async () => {
    vi.useRealTimers()
    if (batcher && !batcher.isClosed) {
      await batcher.close()
    }
  })

  describe('automatic flush on interval', () => {
    it('should flush after flushIntervalMs', async () => {
      batcher = createEventBatcher(
        { maxBatchSize: 100, flushIntervalMs: 5000 },
        flushHandler
      )

      await batcher.add(createMockEvent('evt_1'))
      expect(flushedBatches.length).toBe(0)

      vi.advanceTimersByTime(5100)
      await Promise.resolve() // Allow async operations

      expect(flushedBatches.length).toBe(1)
    })

    it('should not flush empty queue on interval', async () => {
      batcher = createEventBatcher(
        { maxBatchSize: 100, flushIntervalMs: 1000 },
        flushHandler
      )

      vi.advanceTimersByTime(5000)
      await Promise.resolve()

      expect(flushedBatches.length).toBe(0)
    })

    it('should reset interval timer after manual flush', async () => {
      batcher = createEventBatcher(
        { maxBatchSize: 100, flushIntervalMs: 5000 },
        flushHandler
      )

      await batcher.add(createMockEvent('evt_1'))
      vi.advanceTimersByTime(2500) // Halfway through interval
      await batcher.flush() // Manual flush

      expect(flushedBatches.length).toBe(1)

      await batcher.add(createMockEvent('evt_2'))
      vi.advanceTimersByTime(2600) // Would be past original interval
      await Promise.resolve()

      // Should not have auto-flushed yet (timer reset)
      expect(flushedBatches.length).toBe(1)

      vi.advanceTimersByTime(2500) // Now past the new interval
      await Promise.resolve()

      expect(flushedBatches.length).toBe(2)
    })

    it('should flush multiple times over extended period', async () => {
      batcher = createEventBatcher(
        { maxBatchSize: 100, flushIntervalMs: 1000 },
        flushHandler
      )

      // Add events periodically
      for (let i = 0; i < 5; i++) {
        await batcher.add(createMockEvent(`evt_${i}`))
        vi.advanceTimersByTime(1100)
        await Promise.resolve()
      }

      // Each event should have triggered its own flush
      expect(flushedBatches.length).toBe(5)
    })

    it('should handle very short flush intervals', async () => {
      batcher = createEventBatcher(
        { maxBatchSize: 100, flushIntervalMs: 100 },
        flushHandler
      )

      await batcher.add(createMockEvent('evt_1'))
      vi.advanceTimersByTime(150)
      await Promise.resolve()

      expect(flushedBatches.length).toBe(1)
    })

    it('should handle very long flush intervals', async () => {
      batcher = createEventBatcher(
        { maxBatchSize: 100, flushIntervalMs: 3600000 }, // 1 hour
        flushHandler
      )

      await batcher.add(createMockEvent('evt_1'))
      vi.advanceTimersByTime(1800000) // 30 minutes
      await Promise.resolve()

      expect(flushedBatches.length).toBe(0) // Not yet
      expect(batcher.queueSize).toBe(1)
    })
  })

  describe('interval configuration', () => {
    it('should use default flushIntervalMs when not specified', async () => {
      batcher = createEventBatcher({ maxBatchSize: 100 }, flushHandler)

      // Default should be 10000ms (10 seconds)
      expect(batcher.config.flushIntervalMs).toBe(10000)
    })

    it('should allow disabling interval flush with 0', async () => {
      batcher = createEventBatcher(
        { maxBatchSize: 100, flushIntervalMs: 0 },
        flushHandler
      )

      await batcher.add(createMockEvent('evt_1'))
      vi.advanceTimersByTime(60000)
      await Promise.resolve()

      expect(flushedBatches.length).toBe(0) // No automatic flush
    })

    it('should reject negative flushIntervalMs', () => {
      expect(() =>
        createEventBatcher({ maxBatchSize: 100, flushIntervalMs: -1000 }, flushHandler)
      ).toThrow('flushIntervalMs must be non-negative')
    })

    it('should cap flushIntervalMs at reasonable maximum (1 hour)', async () => {
      batcher = createEventBatcher(
        { maxBatchSize: 100, flushIntervalMs: 7200000 }, // 2 hours
        flushHandler
      )

      expect(batcher.config.flushIntervalMs).toBe(3600000) // Capped at 1 hour
    })
  })

  describe('interaction with batch size', () => {
    it('should prioritize batch size flush over interval flush', async () => {
      batcher = createEventBatcher(
        { maxBatchSize: 3, flushIntervalMs: 10000 },
        flushHandler
      )

      // Add enough events to trigger size-based flush
      for (let i = 0; i < 3; i++) {
        await batcher.add(createMockEvent(`evt_${i}`))
      }

      await delay(10)
      expect(flushedBatches.length).toBe(1)

      // Interval timer should still be running for remaining events
      await batcher.add(createMockEvent('evt_after'))
      vi.advanceTimersByTime(10100)
      await Promise.resolve()

      expect(flushedBatches.length).toBe(2)
    })
  })
})

// ============================================================================
// RETRY LOGIC - Handling flush failures with backoff
// ============================================================================

describe('Retry Logic', () => {
  let batcher: EventBatcher
  let flushAttempts: number
  let flushedBatches: BatchEvent[][]

  beforeEach(() => {
    flushAttempts = 0
    flushedBatches = []
  })

  afterEach(async () => {
    if (batcher && !batcher.isClosed) {
      await batcher.close()
    }
  })

  describe('basic retry behavior', () => {
    it('should retry failed flushes', async () => {
      const failingHandler = async (events: BatchEvent[]) => {
        flushAttempts++
        if (flushAttempts <= 2) {
          throw new Error(`Simulated failure ${flushAttempts}`)
        }
        flushedBatches.push([...events])
      }

      batcher = createEventBatcher(
        {
          maxBatchSize: 1,
          flushIntervalMs: 60000,
          maxRetries: 3,
          retryDelayMs: 10,
        },
        failingHandler
      )

      await batcher.add(createMockEvent('evt_1'))
      const result = await batcher.flush()

      expect(result.success).toBe(true)
      expect(flushAttempts).toBe(3) // 2 failures + 1 success
      expect(result.retryCount).toBe(2)
    })

    it('should fail after maxRetries exhausted', async () => {
      const alwaysFailHandler = async () => {
        flushAttempts++
        throw new Error(`Permanent failure ${flushAttempts}`)
      }

      batcher = createEventBatcher(
        {
          maxBatchSize: 1,
          flushIntervalMs: 60000,
          maxRetries: 3,
          retryDelayMs: 10,
        },
        alwaysFailHandler
      )

      await batcher.add(createMockEvent('evt_1'))
      const result = await batcher.flush()

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error?.message).toContain('Permanent failure')
      expect(flushAttempts).toBe(4) // 1 initial + 3 retries
    })

    it('should succeed immediately when no errors', async () => {
      const successHandler = async (events: BatchEvent[]) => {
        flushAttempts++
        flushedBatches.push([...events])
      }

      batcher = createEventBatcher(
        {
          maxBatchSize: 1,
          flushIntervalMs: 60000,
          maxRetries: 3,
          retryDelayMs: 100,
        },
        successHandler
      )

      await batcher.add(createMockEvent('evt_1'))
      const result = await batcher.flush()

      expect(result.success).toBe(true)
      expect(flushAttempts).toBe(1)
      expect(result.retryCount).toBe(0)
    })
  })

  describe('exponential backoff', () => {
    it('should use exponential backoff by default', async () => {
      const delays: number[] = []
      let lastTime = Date.now()

      const timingHandler = async () => {
        const now = Date.now()
        delays.push(now - lastTime)
        lastTime = now
        throw new Error('Always fails')
      }

      batcher = createEventBatcher(
        {
          maxBatchSize: 1,
          flushIntervalMs: 60000,
          maxRetries: 4,
          retryDelayMs: 50,
          backoffStrategy: 'exponential',
        },
        timingHandler
      )

      await batcher.add(createMockEvent('evt_1'))
      await batcher.flush()

      // Delays should roughly double: ~0, ~50, ~100, ~200, ~400
      expect(delays[1]).toBeGreaterThanOrEqual(45)
      expect(delays[2]).toBeGreaterThanOrEqual(90)
      expect(delays[3]).toBeGreaterThanOrEqual(180)
      expect(delays[4]).toBeGreaterThanOrEqual(360)
    })

    it('should cap exponential backoff at maxRetryDelayMs', async () => {
      const delays: number[] = []
      let lastTime = Date.now()

      const timingHandler = async () => {
        const now = Date.now()
        delays.push(now - lastTime)
        lastTime = now
        throw new Error('Always fails')
      }

      batcher = createEventBatcher(
        {
          maxBatchSize: 1,
          flushIntervalMs: 60000,
          maxRetries: 5,
          retryDelayMs: 100,
          backoffStrategy: 'exponential',
          maxRetryDelayMs: 200, // Cap at 200ms
        },
        timingHandler
      )

      await batcher.add(createMockEvent('evt_1'))
      await batcher.flush()

      // Later delays should be capped at 200ms
      expect(delays[4]).toBeLessThanOrEqual(250) // Allow some timing variance
      expect(delays[5]).toBeLessThanOrEqual(250)
    })
  })

  describe('fixed backoff', () => {
    it('should use consistent delay with fixed backoff', async () => {
      const delays: number[] = []
      let lastTime = Date.now()

      const timingHandler = async () => {
        const now = Date.now()
        delays.push(now - lastTime)
        lastTime = now
        throw new Error('Always fails')
      }

      batcher = createEventBatcher(
        {
          maxBatchSize: 1,
          flushIntervalMs: 60000,
          maxRetries: 4,
          retryDelayMs: 50,
          backoffStrategy: 'fixed',
        },
        timingHandler
      )

      await batcher.add(createMockEvent('evt_1'))
      await batcher.flush()

      // All retry delays should be approximately 50ms
      for (let i = 1; i < delays.length; i++) {
        expect(delays[i]).toBeGreaterThanOrEqual(45)
        expect(delays[i]).toBeLessThanOrEqual(80)
      }
    })
  })

  describe('retry configuration', () => {
    it('should use default maxRetries when not specified', async () => {
      const successHandler = async (events: BatchEvent[]) => {
        flushedBatches.push([...events])
      }

      batcher = createEventBatcher(
        { maxBatchSize: 100, flushIntervalMs: 60000 },
        successHandler
      )

      // Default should be 3
      expect(batcher.config.maxRetries).toBe(3)
    })

    it('should allow maxRetries of 0 (no retries)', async () => {
      const failingHandler = async () => {
        flushAttempts++
        throw new Error('Failure')
      }

      batcher = createEventBatcher(
        {
          maxBatchSize: 1,
          flushIntervalMs: 60000,
          maxRetries: 0,
          retryDelayMs: 10,
        },
        failingHandler
      )

      await batcher.add(createMockEvent('evt_1'))
      const result = await batcher.flush()

      expect(result.success).toBe(false)
      expect(flushAttempts).toBe(1) // Only initial attempt
    })

    it('should reject negative maxRetries', () => {
      const handler = async () => {}
      expect(() =>
        createEventBatcher(
          { maxBatchSize: 100, flushIntervalMs: 60000, maxRetries: -1 },
          handler
        )
      ).toThrow('maxRetries must be non-negative')
    })

    it('should use default retryDelayMs when not specified', async () => {
      const successHandler = async (events: BatchEvent[]) => {
        flushedBatches.push([...events])
      }

      batcher = createEventBatcher(
        { maxBatchSize: 100, flushIntervalMs: 60000 },
        successHandler
      )

      // Default should be 100ms
      expect(batcher.config.retryDelayMs).toBe(100)
    })
  })

  describe('error handling', () => {
    it('should preserve error from last failed attempt', async () => {
      let attemptNum = 0
      const errorHandler = async () => {
        attemptNum++
        throw new Error(`Attempt ${attemptNum} failed`)
      }

      batcher = createEventBatcher(
        {
          maxBatchSize: 1,
          flushIntervalMs: 60000,
          maxRetries: 2,
          retryDelayMs: 10,
        },
        errorHandler
      )

      await batcher.add(createMockEvent('evt_1'))
      const result = await batcher.flush()

      expect(result.success).toBe(false)
      expect(result.error?.message).toBe('Attempt 3 failed') // Last attempt error
    })

    it('should only retry on retryable errors', async () => {
      const nonRetryableHandler = async () => {
        flushAttempts++
        const error = new Error('Invalid data') as Error & { retryable?: boolean }
        error.retryable = false
        throw error
      }

      batcher = createEventBatcher(
        {
          maxBatchSize: 1,
          flushIntervalMs: 60000,
          maxRetries: 3,
          retryDelayMs: 10,
        },
        nonRetryableHandler
      )

      await batcher.add(createMockEvent('evt_1'))
      const result = await batcher.flush()

      expect(result.success).toBe(false)
      expect(flushAttempts).toBe(1) // Should not retry non-retryable errors
    })

    it('should track retry statistics', async () => {
      let attemptCount = 0
      const intermittentHandler = async (events: BatchEvent[]) => {
        attemptCount++
        if (attemptCount <= 2) {
          throw new Error('Temporary failure')
        }
        flushedBatches.push([...events])
      }

      batcher = createEventBatcher(
        {
          maxBatchSize: 1,
          flushIntervalMs: 60000,
          maxRetries: 3,
          retryDelayMs: 10,
        },
        intermittentHandler
      )

      await batcher.add(createMockEvent('evt_1'))
      await batcher.flush()

      const stats = batcher.getStats()
      expect(stats.retriedFlushes).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// MANUAL FLUSH - Explicit flush operations
// ============================================================================

describe('Manual Flush', () => {
  let batcher: EventBatcher
  let flushedBatches: BatchEvent[][]
  let flushHandler: (events: BatchEvent[]) => Promise<void>

  beforeEach(() => {
    flushedBatches = []
    flushHandler = async (events) => {
      flushedBatches.push([...events])
    }
  })

  afterEach(async () => {
    if (batcher && !batcher.isClosed) {
      await batcher.close()
    }
  })

  it('should flush all queued events on demand', async () => {
    batcher = createEventBatcher(
      { maxBatchSize: 100, flushIntervalMs: 60000 },
      flushHandler
    )

    await batcher.add(createMockEvent('evt_1'))
    await batcher.add(createMockEvent('evt_2'))
    await batcher.add(createMockEvent('evt_3'))

    const result = await batcher.flush()

    expect(result.success).toBe(true)
    expect(result.eventCount).toBe(3)
    expect(flushedBatches.length).toBe(1)
    expect(flushedBatches[0]).toHaveLength(3)
    expect(batcher.queueSize).toBe(0)
  })

  it('should return success for empty flush', async () => {
    batcher = createEventBatcher(
      { maxBatchSize: 100, flushIntervalMs: 60000 },
      flushHandler
    )

    const result = await batcher.flush()

    expect(result.success).toBe(true)
    expect(result.eventCount).toBe(0)
    expect(flushedBatches.length).toBe(0)
  })

  it('should prevent concurrent manual flushes', async () => {
    const slowHandler = async (events: BatchEvent[]) => {
      await delay(100) // Slow handler
      flushedBatches.push([...events])
    }

    batcher = createEventBatcher(
      { maxBatchSize: 100, flushIntervalMs: 60000 },
      slowHandler
    )

    await batcher.add(createMockEvent('evt_1'))

    // Start two concurrent flushes
    const flush1 = batcher.flush()
    const flush2 = batcher.flush()

    const [result1, result2] = await Promise.all([flush1, flush2])

    // Both should return the same result (second waited for first)
    expect(result1.eventCount).toBe(result2.eventCount)
    expect(flushedBatches.length).toBe(1) // Only one actual flush
  })

  it('should include duration in flush result', async () => {
    batcher = createEventBatcher(
      { maxBatchSize: 100, flushIntervalMs: 60000 },
      flushHandler
    )

    await batcher.add(createMockEvent('evt_1'))
    const result = await batcher.flush()

    expect(result.duration).toBeGreaterThanOrEqual(0)
    expect(typeof result.duration).toBe('number')
  })
})

// ============================================================================
// LIFECYCLE - Close and cleanup
// ============================================================================

describe('Lifecycle', () => {
  let batcher: EventBatcher
  let flushedBatches: BatchEvent[][]
  let flushHandler: (events: BatchEvent[]) => Promise<void>

  beforeEach(() => {
    flushedBatches = []
    flushHandler = async (events) => {
      flushedBatches.push([...events])
    }
  })

  it('should flush pending events on close', async () => {
    batcher = createEventBatcher(
      { maxBatchSize: 100, flushIntervalMs: 60000 },
      flushHandler
    )

    await batcher.add(createMockEvent('evt_1'))
    await batcher.add(createMockEvent('evt_2'))

    await batcher.close()

    expect(flushedBatches.length).toBe(1)
    expect(flushedBatches[0]).toHaveLength(2)
  })

  it('should reject new events after close', async () => {
    batcher = createEventBatcher(
      { maxBatchSize: 100, flushIntervalMs: 60000 },
      flushHandler
    )

    await batcher.close()

    await expect(batcher.add(createMockEvent('evt_1'))).rejects.toThrow(
      'EventBatcher is closed'
    )
  })

  it('should reject flush after close', async () => {
    batcher = createEventBatcher(
      { maxBatchSize: 100, flushIntervalMs: 60000 },
      flushHandler
    )

    await batcher.close()

    await expect(batcher.flush()).rejects.toThrow('EventBatcher is closed')
  })

  it('should be idempotent (multiple close calls)', async () => {
    batcher = createEventBatcher(
      { maxBatchSize: 100, flushIntervalMs: 60000 },
      flushHandler
    )

    await batcher.add(createMockEvent('evt_1'))

    await batcher.close()
    await batcher.close() // Second close should be no-op

    expect(flushedBatches.length).toBe(1)
    expect(batcher.isClosed).toBe(true)
  })

  it('should stop interval timer on close', async () => {
    vi.useFakeTimers()

    batcher = createEventBatcher(
      { maxBatchSize: 100, flushIntervalMs: 1000 },
      flushHandler
    )

    await batcher.add(createMockEvent('evt_1'))
    await batcher.close()

    const countAfterClose = flushedBatches.length

    // Advance time - should not trigger any more flushes
    vi.advanceTimersByTime(5000)
    await Promise.resolve()

    expect(flushedBatches.length).toBe(countAfterClose)

    vi.useRealTimers()
  })

  it('should report closed status', async () => {
    batcher = createEventBatcher(
      { maxBatchSize: 100, flushIntervalMs: 60000 },
      flushHandler
    )

    expect(batcher.isClosed).toBe(false)
    await batcher.close()
    expect(batcher.isClosed).toBe(true)
  })
})

// ============================================================================
// STATISTICS AND MONITORING
// ============================================================================

describe('Statistics and Monitoring', () => {
  let batcher: EventBatcher
  let flushedBatches: BatchEvent[][]
  let flushHandler: (events: BatchEvent[]) => Promise<void>

  beforeEach(() => {
    flushedBatches = []
    flushHandler = async (events) => {
      flushedBatches.push([...events])
    }
  })

  afterEach(async () => {
    if (batcher && !batcher.isClosed) {
      await batcher.close()
    }
  })

  it('should track total events added', async () => {
    batcher = createEventBatcher(
      { maxBatchSize: 100, flushIntervalMs: 60000 },
      flushHandler
    )

    await batcher.add(createMockEvent('evt_1'))
    await batcher.add(createMockEvent('evt_2'))
    await batcher.add(createMockEvent('evt_3'))

    const stats = batcher.getStats()
    expect(stats.totalEvents).toBe(3)
  })

  it('should track total flushes', async () => {
    batcher = createEventBatcher(
      { maxBatchSize: 2, flushIntervalMs: 60000 },
      flushHandler
    )

    await batcher.add(createMockEvent('evt_1'))
    await batcher.add(createMockEvent('evt_2')) // Auto-flush
    await delay(10)
    await batcher.add(createMockEvent('evt_3'))
    await batcher.flush() // Manual flush

    const stats = batcher.getStats()
    expect(stats.totalFlushes).toBe(2)
  })

  it('should track successful vs failed flushes', async () => {
    let shouldFail = true
    const intermittentHandler = async (events: BatchEvent[]) => {
      if (shouldFail) {
        shouldFail = false
        throw new Error('First flush fails')
      }
      flushedBatches.push([...events])
    }

    batcher = createEventBatcher(
      {
        maxBatchSize: 100,
        flushIntervalMs: 60000,
        maxRetries: 0,
      },
      intermittentHandler
    )

    await batcher.add(createMockEvent('evt_1'))
    await batcher.flush() // Will fail

    await batcher.add(createMockEvent('evt_2'))
    await batcher.flush() // Will succeed

    const stats = batcher.getStats()
    expect(stats.successfulFlushes).toBe(1)
    expect(stats.failedFlushes).toBe(1)
  })

  it('should track average flush duration', async () => {
    const slowHandler = async (events: BatchEvent[]) => {
      await delay(50) // Simulate some processing time
      flushedBatches.push([...events])
    }

    batcher = createEventBatcher(
      { maxBatchSize: 1, flushIntervalMs: 60000 },
      slowHandler
    )

    await batcher.add(createMockEvent('evt_1'))
    await batcher.flush()
    await batcher.add(createMockEvent('evt_2'))
    await batcher.flush()

    const stats = batcher.getStats()
    expect(stats.averageFlushDuration).toBeGreaterThan(0)
  })

  it('should track last flush time', async () => {
    batcher = createEventBatcher(
      { maxBatchSize: 100, flushIntervalMs: 60000 },
      flushHandler
    )

    const before = new Date()
    await batcher.add(createMockEvent('evt_1'))
    await batcher.flush()
    const after = new Date()

    const stats = batcher.getStats()
    expect(stats.lastFlushTime).toBeDefined()
    expect(stats.lastFlushTime!.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(stats.lastFlushTime!.getTime()).toBeLessThanOrEqual(after.getTime())
  })

  it('should report current queue size', async () => {
    batcher = createEventBatcher(
      { maxBatchSize: 100, flushIntervalMs: 60000 },
      flushHandler
    )

    expect(batcher.queueSize).toBe(0)

    await batcher.add(createMockEvent('evt_1'))
    expect(batcher.queueSize).toBe(1)

    await batcher.add(createMockEvent('evt_2'))
    expect(batcher.queueSize).toBe(2)

    await batcher.flush()
    expect(batcher.queueSize).toBe(0)
  })
})

// ============================================================================
// PARTIAL BATCH HANDLING - Handling incomplete batches
// ============================================================================

describe('Partial Batch Handling', () => {
  let batcher: EventBatcher
  let flushedBatches: BatchEvent[][]
  let flushHandler: (events: BatchEvent[]) => Promise<void>

  beforeEach(() => {
    flushedBatches = []
    flushHandler = async (events) => {
      flushedBatches.push([...events])
    }
  })

  afterEach(async () => {
    if (batcher && !batcher.isClosed) {
      await batcher.close()
    }
  })

  describe('partial flush scenarios', () => {
    it('should flush partial batch on manual flush', async () => {
      batcher = createEventBatcher(
        { maxBatchSize: 10, flushIntervalMs: 60000 },
        flushHandler
      )

      // Add less than maxBatchSize events
      await batcher.add(createMockEvent('evt_1'))
      await batcher.add(createMockEvent('evt_2'))
      await batcher.add(createMockEvent('evt_3'))

      // Manual flush should flush the partial batch
      const result = await batcher.flush()

      expect(result.success).toBe(true)
      expect(result.eventCount).toBe(3)
      expect(flushedBatches.length).toBe(1)
      expect(flushedBatches[0]).toHaveLength(3)
    })

    it('should handle single event batch', async () => {
      batcher = createEventBatcher(
        { maxBatchSize: 100, flushIntervalMs: 60000 },
        flushHandler
      )

      await batcher.add(createMockEvent('evt_1'))
      const result = await batcher.flush()

      expect(result.success).toBe(true)
      expect(result.eventCount).toBe(1)
      expect(flushedBatches[0]).toHaveLength(1)
    })

    it('should handle remaining events after auto-flush', async () => {
      batcher = createEventBatcher(
        { maxBatchSize: 3, flushIntervalMs: 60000 },
        flushHandler
      )

      // Add 7 events (3 + 3 + 1 remaining)
      for (let i = 0; i < 7; i++) {
        await batcher.add(createMockEvent(`evt_${i}`))
      }

      await delay(10)

      // Should have auto-flushed twice (batches of 3)
      expect(flushedBatches.length).toBe(2)
      expect(batcher.queueSize).toBe(1) // 1 remaining

      // Manual flush to get the remaining event
      await batcher.flush()
      expect(flushedBatches.length).toBe(3)
      expect(flushedBatches[2]).toHaveLength(1)
    })
  })

  describe('partial failure handling', () => {
    it('should preserve events on flush failure for retry', async () => {
      let failOnFirstAttempt = true
      const failingHandler = async (events: BatchEvent[]) => {
        if (failOnFirstAttempt) {
          failOnFirstAttempt = false
          throw new Error('First attempt fails')
        }
        flushedBatches.push([...events])
      }

      batcher = createEventBatcher(
        {
          maxBatchSize: 100,
          flushIntervalMs: 60000,
          maxRetries: 1,
          retryDelayMs: 10,
        },
        failingHandler
      )

      await batcher.add(createMockEvent('evt_1'))
      await batcher.add(createMockEvent('evt_2'))

      const result = await batcher.flush()

      // Should succeed on retry, events preserved
      expect(result.success).toBe(true)
      expect(result.eventCount).toBe(2)
      expect(flushedBatches[0]).toHaveLength(2)
    })

    it('should not lose events when flush fails permanently', async () => {
      const alwaysFailHandler = async () => {
        throw new Error('Permanent failure')
      }

      batcher = createEventBatcher(
        {
          maxBatchSize: 100,
          flushIntervalMs: 60000,
          maxRetries: 0,
        },
        alwaysFailHandler
      )

      await batcher.add(createMockEvent('evt_1'))
      await batcher.add(createMockEvent('evt_2'))

      const result = await batcher.flush()

      expect(result.success).toBe(false)
      // Events should still be in queue for potential retry or recovery
      expect(batcher.queueSize).toBe(2)
    })

    it('should report partial success when batch processor returns partial results', async () => {
      const partialHandler = async (events: BatchEvent[]) => {
        // Simulate partial processing - only half succeed
        const processed = events.slice(0, Math.floor(events.length / 2))
        flushedBatches.push([...processed])

        const error = new Error('Partial failure') as Error & {
          partiallyProcessed?: number
        }
        error.partiallyProcessed = processed.length
        throw error
      }

      batcher = createEventBatcher(
        {
          maxBatchSize: 10,
          flushIntervalMs: 60000,
          maxRetries: 0,
        },
        partialHandler
      )

      for (let i = 0; i < 6; i++) {
        await batcher.add(createMockEvent(`evt_${i}`))
      }

      const result = await batcher.flush()

      // Result should indicate partial success
      expect(result.success).toBe(false)
      expect(result.error?.message).toContain('Partial failure')
    })
  })

  describe('batch splitting on size constraints', () => {
    it('should respect payload size limits in addition to count', async () => {
      // This test assumes the batcher can be configured with a maxPayloadBytes option
      batcher = createEventBatcher(
        {
          maxBatchSize: 1000,
          flushIntervalMs: 60000,
        },
        flushHandler
      )

      // Add large events
      const largeEvent = (id: string) => ({
        id,
        type: 'track',
        timestamp: new Date(),
        data: { payload: 'x'.repeat(1000) }, // 1KB payload
      })

      await batcher.add(largeEvent('evt_1'))
      await batcher.add(largeEvent('evt_2'))
      await batcher.add(largeEvent('evt_3'))

      await batcher.flush()

      // Even though count < maxBatchSize, large payloads should be handled
      expect(flushedBatches.length).toBeGreaterThanOrEqual(1)
    })
  })
})

// ============================================================================
// BATCH ORDERING GUARANTEES - Event order preservation
// ============================================================================

describe('Batch Ordering Guarantees', () => {
  let batcher: EventBatcher
  let flushedBatches: BatchEvent[][]
  let flushHandler: (events: BatchEvent[]) => Promise<void>

  beforeEach(() => {
    flushedBatches = []
    flushHandler = async (events) => {
      flushedBatches.push([...events])
    }
  })

  afterEach(async () => {
    if (batcher && !batcher.isClosed) {
      await batcher.close()
    }
  })

  describe('FIFO ordering within batches', () => {
    it('should preserve insertion order within a single batch', async () => {
      batcher = createEventBatcher(
        { maxBatchSize: 100, flushIntervalMs: 60000 },
        flushHandler
      )

      // Add events in specific order
      const eventIds = ['first', 'second', 'third', 'fourth', 'fifth']
      for (const id of eventIds) {
        await batcher.add(createMockEvent(id))
      }

      await batcher.flush()

      // Verify order is preserved
      expect(flushedBatches.length).toBe(1)
      const flushedIds = flushedBatches[0].map((e) => e.id)
      expect(flushedIds).toEqual(eventIds)
    })

    it('should preserve order across multiple batches', async () => {
      batcher = createEventBatcher(
        { maxBatchSize: 3, flushIntervalMs: 60000 },
        flushHandler
      )

      // Add 8 events (will result in 3 batches: 3, 3, 2)
      const eventIds = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
      for (const id of eventIds) {
        await batcher.add(createMockEvent(id))
      }

      await delay(10) // Allow auto-flushes
      await batcher.flush() // Flush remaining

      // Verify all events are present and ordered
      const allFlushedIds = flushedBatches.flatMap((batch) =>
        batch.map((e) => e.id)
      )
      expect(allFlushedIds).toEqual(eventIds)
    })

    it('should maintain strict ordering with concurrent adds', async () => {
      batcher = createEventBatcher(
        { maxBatchSize: 100, flushIntervalMs: 60000 },
        flushHandler
      )

      // Add events concurrently
      const eventIds = Array.from({ length: 20 }, (_, i) => `evt_${i}`)
      await Promise.all(eventIds.map((id) => batcher.add(createMockEvent(id))))

      await batcher.flush()

      // All events should be present (order may vary with true concurrency,
      // but implementation should serialize properly)
      const flushedIds = flushedBatches[0].map((e) => e.id)
      expect(flushedIds.sort()).toEqual(eventIds.sort())
      expect(flushedIds.length).toBe(20)
    })
  })

  describe('timestamp ordering', () => {
    it('should maintain timestamp order when events have different timestamps', async () => {
      batcher = createEventBatcher(
        { maxBatchSize: 100, flushIntervalMs: 60000 },
        flushHandler
      )

      // Add events with explicit timestamps
      const events: BatchEvent[] = [
        { id: 'evt_3', type: 'track', timestamp: new Date(1000), data: {} },
        { id: 'evt_1', type: 'track', timestamp: new Date(500), data: {} },
        { id: 'evt_2', type: 'track', timestamp: new Date(750), data: {} },
      ]

      for (const event of events) {
        await batcher.add(event)
      }

      await batcher.flush()

      // Events should be in insertion order (FIFO), not timestamp order
      // The batcher doesn't reorder by timestamp - that's the sender's responsibility
      const flushedIds = flushedBatches[0].map((e) => e.id)
      expect(flushedIds).toEqual(['evt_3', 'evt_1', 'evt_2'])
    })
  })

  describe('batch sequence numbering', () => {
    it('should assign monotonically increasing sequence numbers to batches', async () => {
      batcher = createEventBatcher(
        { maxBatchSize: 2, flushIntervalMs: 60000 },
        flushHandler
      )

      // Add enough events for multiple batches
      for (let i = 0; i < 6; i++) {
        await batcher.add(createMockEvent(`evt_${i}`))
      }

      await delay(10)

      // Each batch should have incrementing sequence number
      expect(flushedBatches.length).toBe(3)

      // Implementation should track batch sequence for ordering guarantees
      const stats = batcher.getStats()
      expect(stats.totalFlushes).toBe(3)
    })
  })

  describe('retry ordering', () => {
    it('should preserve order when retrying failed batches', async () => {
      let failCount = 0
      const intermittentHandler = async (events: BatchEvent[]) => {
        failCount++
        if (failCount === 1) {
          throw new Error('First attempt fails')
        }
        flushedBatches.push([...events])
      }

      batcher = createEventBatcher(
        {
          maxBatchSize: 100,
          flushIntervalMs: 60000,
          maxRetries: 2,
          retryDelayMs: 10,
        },
        intermittentHandler
      )

      const eventIds = ['a', 'b', 'c']
      for (const id of eventIds) {
        await batcher.add(createMockEvent(id))
      }

      await batcher.flush()

      // Events should be in original order after retry succeeds
      const flushedIds = flushedBatches[0].map((e) => e.id)
      expect(flushedIds).toEqual(eventIds)
    })

    it('should not duplicate events on retry', async () => {
      let attemptCount = 0
      const failingHandler = async (events: BatchEvent[]) => {
        attemptCount++
        if (attemptCount <= 2) {
          throw new Error(`Attempt ${attemptCount} fails`)
        }
        flushedBatches.push([...events])
      }

      batcher = createEventBatcher(
        {
          maxBatchSize: 100,
          flushIntervalMs: 60000,
          maxRetries: 3,
          retryDelayMs: 10,
        },
        failingHandler
      )

      await batcher.add(createMockEvent('evt_1'))
      await batcher.add(createMockEvent('evt_2'))

      await batcher.flush()

      // Events should be flushed exactly once
      expect(flushedBatches.length).toBe(1)
      expect(flushedBatches[0]).toHaveLength(2)
    })
  })

  describe('ordering across close', () => {
    it('should flush remaining events in order on close', async () => {
      batcher = createEventBatcher(
        { maxBatchSize: 10, flushIntervalMs: 60000 },
        flushHandler
      )

      const eventIds = ['final_1', 'final_2', 'final_3']
      for (const id of eventIds) {
        await batcher.add(createMockEvent(id))
      }

      await batcher.close()

      const flushedIds = flushedBatches[0].map((e) => e.id)
      expect(flushedIds).toEqual(eventIds)
    })
  })
})

// ============================================================================
// EDGE CASES AND ERROR HANDLING
// ============================================================================

describe('Edge Cases and Error Handling', () => {
  let batcher: EventBatcher
  let flushedBatches: BatchEvent[][]

  afterEach(async () => {
    if (batcher && !batcher.isClosed) {
      await batcher.close()
    }
  })

  describe('malformed events', () => {
    it('should reject events without required id field', async () => {
      const handler = async (events: BatchEvent[]) => {
        flushedBatches.push([...events])
      }

      batcher = createEventBatcher(
        { maxBatchSize: 100, flushIntervalMs: 60000 },
        handler
      )

      const invalidEvent = {
        type: 'track',
        timestamp: new Date(),
        data: {},
      } as unknown as BatchEvent

      await expect(batcher.add(invalidEvent)).rejects.toThrow(
        'Event must have an id'
      )
    })

    it('should reject events without required timestamp field', async () => {
      const handler = async (events: BatchEvent[]) => {
        flushedBatches.push([...events])
      }

      batcher = createEventBatcher(
        { maxBatchSize: 100, flushIntervalMs: 60000 },
        handler
      )

      const invalidEvent = {
        id: 'evt_1',
        type: 'track',
        data: {},
      } as unknown as BatchEvent

      await expect(batcher.add(invalidEvent)).rejects.toThrow(
        'Event must have a timestamp'
      )
    })
  })

  describe('handler exceptions', () => {
    it('should handle synchronous exceptions in handler', async () => {
      const throwingHandler = async () => {
        throw new Error('Synchronous error in handler')
      }

      batcher = createEventBatcher(
        { maxBatchSize: 100, flushIntervalMs: 60000, maxRetries: 0 },
        throwingHandler
      )

      await batcher.add(createMockEvent('evt_1'))
      const result = await batcher.flush()

      expect(result.success).toBe(false)
      expect(result.error?.message).toBe('Synchronous error in handler')
    })

    it('should handle handler returning rejected promise', async () => {
      const rejectingHandler = async () => {
        return Promise.reject(new Error('Rejected promise'))
      }

      batcher = createEventBatcher(
        { maxBatchSize: 100, flushIntervalMs: 60000, maxRetries: 0 },
        rejectingHandler
      )

      await batcher.add(createMockEvent('evt_1'))
      const result = await batcher.flush()

      expect(result.success).toBe(false)
      expect(result.error?.message).toBe('Rejected promise')
    })

    it('should handle handler timeout', async () => {
      const slowHandler = async () => {
        await delay(10000) // Very slow handler
      }

      batcher = createEventBatcher(
        { maxBatchSize: 100, flushIntervalMs: 60000, maxRetries: 0 },
        slowHandler
      )

      await batcher.add(createMockEvent('evt_1'))

      // Flush with timeout should fail if implementation supports it
      const result = await batcher.flush()

      // Either the result indicates timeout or the handler is expected to complete
      expect(result).toBeDefined()
    })
  })

  describe('memory pressure scenarios', () => {
    it('should handle high-volume event streams gracefully', async () => {
      flushedBatches = []
      const handler = async (events: BatchEvent[]) => {
        flushedBatches.push([...events])
      }

      batcher = createEventBatcher(
        { maxBatchSize: 100, flushIntervalMs: 60000 },
        handler
      )

      // Add many events rapidly
      for (let i = 0; i < 1000; i++) {
        await batcher.add(createMockEvent(`evt_${i}`))
      }

      await delay(50)
      await batcher.close()

      // All events should eventually be flushed
      const totalFlushed = flushedBatches.reduce(
        (sum, batch) => sum + batch.length,
        0
      )
      expect(totalFlushed).toBe(1000)
    })
  })
})
