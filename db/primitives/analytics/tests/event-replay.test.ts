/**
 * Event Replay Tests - TDD Tests for Dead Letter Queue and Replay
 *
 * Tests for event replay functionality including:
 * - Dead letter queue storage and retrieval
 * - Replay of individual and batches of failed events
 * - Tracking replay attempts and outcomes
 * - Filtering which events to replay
 * - Idempotent replay (no duplicates)
 * - Integration with EventBatcher
 *
 * @module db/primitives/analytics/tests/event-replay
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  EventBatcher,
  createEventBatcher,
  type BatchEvent,
  type DeadLetterEntry,
  type ReplayOptions,
  type ReplayResult,
} from '../event-batcher'

// ============================================================================
// TEST HELPERS
// ============================================================================

function createMockEvent(id: string, type = 'track'): BatchEvent {
  return {
    id,
    type,
    timestamp: new Date(),
    data: { value: Math.random() },
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================================================
// DEAD LETTER QUEUE STORAGE
// ============================================================================

describe('Dead Letter Queue Storage', () => {
  let batcher: EventBatcher
  let flushedBatches: BatchEvent[][]

  afterEach(async () => {
    if (batcher && !batcher.isClosed) {
      await batcher.close()
    }
  })

  describe('storing failed events', () => {
    it('should store failed events in dead letter queue after max retries', async () => {
      flushedBatches = []
      const alwaysFailHandler = async () => {
        throw new Error('Permanent failure')
      }

      batcher = createEventBatcher(
        {
          maxBatchSize: 100,
          flushIntervalMs: 60000,
          maxRetries: 2,
          retryDelayMs: 10,
        },
        alwaysFailHandler
      )

      await batcher.add(createMockEvent('evt_1'))
      await batcher.add(createMockEvent('evt_2'))
      await batcher.flush()

      const entries = batcher.getDeadLetterEntries()
      expect(entries.length).toBe(1)
      expect(entries[0].events.length).toBe(2)
      expect(entries[0].events[0].id).toBe('evt_1')
      expect(entries[0].events[1].id).toBe('evt_2')
    })

    it('should record error details in dead letter entry', async () => {
      const errorMessage = 'Network timeout'
      const failingHandler = async () => {
        throw new Error(errorMessage)
      }

      batcher = createEventBatcher(
        {
          maxBatchSize: 100,
          flushIntervalMs: 60000,
          maxRetries: 0,
          retryDelayMs: 10,
        },
        failingHandler
      )

      await batcher.add(createMockEvent('evt_1'))
      await batcher.flush()

      const entries = batcher.getDeadLetterEntries()
      expect(entries.length).toBe(1)
      expect(entries[0].error.message).toBe(errorMessage)
    })

    it('should track number of delivery attempts', async () => {
      let attemptCount = 0
      const failingHandler = async () => {
        attemptCount++
        throw new Error('Failure')
      }

      batcher = createEventBatcher(
        {
          maxBatchSize: 100,
          flushIntervalMs: 60000,
          maxRetries: 3,
          retryDelayMs: 5,
        },
        failingHandler
      )

      await batcher.add(createMockEvent('evt_1'))
      await batcher.flush()

      const entries = batcher.getDeadLetterEntries()
      expect(entries.length).toBe(1)
      expect(entries[0].attempts).toBe(4) // 1 initial + 3 retries
    })

    it('should record timestamps for first and last attempt', async () => {
      const failingHandler = async () => {
        throw new Error('Failure')
      }

      batcher = createEventBatcher(
        {
          maxBatchSize: 100,
          flushIntervalMs: 60000,
          maxRetries: 1,
          retryDelayMs: 50,
        },
        failingHandler
      )

      const before = new Date()
      await batcher.add(createMockEvent('evt_1'))
      await batcher.flush()
      const after = new Date()

      const entries = batcher.getDeadLetterEntries()
      expect(entries[0].firstAttemptAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(entries[0].lastAttemptAt.getTime()).toBeLessThanOrEqual(after.getTime())
      expect(entries[0].lastAttemptAt.getTime()).toBeGreaterThanOrEqual(entries[0].firstAttemptAt.getTime())
    })

    it('should not add to DLQ on successful flush', async () => {
      flushedBatches = []
      const successHandler = async (events: BatchEvent[]) => {
        flushedBatches.push([...events])
      }

      batcher = createEventBatcher(
        {
          maxBatchSize: 100,
          flushIntervalMs: 60000,
        },
        successHandler
      )

      await batcher.add(createMockEvent('evt_1'))
      await batcher.flush()

      const entries = batcher.getDeadLetterEntries()
      expect(entries.length).toBe(0)
      expect(flushedBatches.length).toBe(1)
    })

    it('should assign unique IDs to each DLQ entry', async () => {
      let failCount = 0
      const intermittentHandler = async () => {
        failCount++
        if (failCount <= 2) {
          throw new Error(`Failure ${failCount}`)
        }
      }

      batcher = createEventBatcher(
        {
          maxBatchSize: 1,
          flushIntervalMs: 60000,
          maxRetries: 0,
          retryDelayMs: 5,
        },
        intermittentHandler
      )

      // Create two separate failures
      await batcher.add(createMockEvent('evt_1'))
      await batcher.flush()

      await batcher.add(createMockEvent('evt_2'))
      await batcher.flush()

      const entries = batcher.getDeadLetterEntries()
      expect(entries.length).toBe(2)
      expect(entries[0].id).not.toBe(entries[1].id)
    })
  })

  describe('retrieving dead letter entries', () => {
    it('should retrieve entry by ID', async () => {
      const failingHandler = async () => {
        throw new Error('Failure')
      }

      batcher = createEventBatcher(
        {
          maxBatchSize: 100,
          flushIntervalMs: 60000,
          maxRetries: 0,
        },
        failingHandler
      )

      await batcher.add(createMockEvent('evt_1'))
      await batcher.flush()

      const entries = batcher.getDeadLetterEntries()
      const entry = batcher.getDeadLetterEntry(entries[0].id)

      expect(entry).toBeDefined()
      expect(entry?.id).toBe(entries[0].id)
    })

    it('should return undefined for non-existent entry ID', async () => {
      const successHandler = async () => {}

      batcher = createEventBatcher(
        {
          maxBatchSize: 100,
          flushIntervalMs: 60000,
        },
        successHandler
      )

      const entry = batcher.getDeadLetterEntry('non_existent_id')
      expect(entry).toBeUndefined()
    })
  })

  describe('dead letter queue statistics', () => {
    it('should report total entries and events', async () => {
      const failingHandler = async () => {
        throw new Error('Failure')
      }

      batcher = createEventBatcher(
        {
          maxBatchSize: 2,
          flushIntervalMs: 60000,
          maxRetries: 0,
        },
        failingHandler
      )

      await batcher.add(createMockEvent('evt_1'))
      await batcher.add(createMockEvent('evt_2'))
      await batcher.flush()

      await batcher.add(createMockEvent('evt_3'))
      await batcher.flush()

      const stats = batcher.getDeadLetterStats()
      expect(stats.totalEntries).toBe(2)
      expect(stats.totalEvents).toBe(3)
    })

    it('should track pending vs replayed entries', async () => {
      let shouldFail = true
      const handler = async () => {
        if (shouldFail) {
          throw new Error('Failure')
        }
      }

      batcher = createEventBatcher(
        {
          maxBatchSize: 100,
          flushIntervalMs: 60000,
          maxRetries: 0,
        },
        handler
      )

      await batcher.add(createMockEvent('evt_1'))
      await batcher.flush()

      let stats = batcher.getDeadLetterStats()
      expect(stats.pendingReplay).toBe(1)
      expect(stats.replayedSuccessfully).toBe(0)

      // Now replay successfully
      shouldFail = false
      await batcher.replay()

      stats = batcher.getDeadLetterStats()
      expect(stats.pendingReplay).toBe(0)
      expect(stats.replayedSuccessfully).toBe(1)
    })

    it('should track oldest and newest entry timestamps', async () => {
      const failingHandler = async () => {
        throw new Error('Failure')
      }

      batcher = createEventBatcher(
        {
          maxBatchSize: 1,
          flushIntervalMs: 60000,
          maxRetries: 0,
        },
        failingHandler
      )

      await batcher.add(createMockEvent('evt_1'))
      await batcher.flush()
      await delay(10)

      await batcher.add(createMockEvent('evt_2'))
      await batcher.flush()

      const stats = batcher.getDeadLetterStats()
      expect(stats.oldestEntry).toBeDefined()
      expect(stats.newestEntry).toBeDefined()
      expect(stats.newestEntry!.getTime()).toBeGreaterThanOrEqual(stats.oldestEntry!.getTime())
    })
  })
})

// ============================================================================
// REPLAY FUNCTIONALITY
// ============================================================================

describe('Event Replay', () => {
  let batcher: EventBatcher
  let replayedEvents: BatchEvent[][]

  afterEach(async () => {
    if (batcher && !batcher.isClosed) {
      await batcher.close()
    }
  })

  describe('replaying failed events', () => {
    it('should replay all failed events when no filter specified', async () => {
      let shouldFail = true
      replayedEvents = []

      const handler = async (events: BatchEvent[]) => {
        if (shouldFail) {
          throw new Error('Failure')
        }
        replayedEvents.push([...events])
      }

      batcher = createEventBatcher(
        {
          maxBatchSize: 100,
          flushIntervalMs: 60000,
          maxRetries: 0,
        },
        handler
      )

      await batcher.add(createMockEvent('evt_1'))
      await batcher.add(createMockEvent('evt_2'))
      await batcher.flush()

      expect(batcher.getDeadLetterEntries().length).toBe(1)

      shouldFail = false
      const result = await batcher.replay()

      expect(result.succeeded).toBe(1)
      expect(result.failed).toBe(0)
      expect(replayedEvents.length).toBe(1)
      expect(replayedEvents[0].length).toBe(2)
    })

    it('should replay individual entry by ID', async () => {
      let shouldFail = true
      replayedEvents = []

      const handler = async (events: BatchEvent[]) => {
        if (shouldFail) {
          throw new Error('Failure')
        }
        replayedEvents.push([...events])
      }

      batcher = createEventBatcher(
        {
          maxBatchSize: 1,
          flushIntervalMs: 60000,
          maxRetries: 0,
        },
        handler
      )

      // Create two separate failures
      await batcher.add(createMockEvent('evt_1'))
      await batcher.flush()
      await batcher.add(createMockEvent('evt_2'))
      await batcher.flush()

      const entries = batcher.getDeadLetterEntries()
      expect(entries.length).toBe(2)

      shouldFail = false
      const result = await batcher.replayEntry(entries[0].id)

      expect(result.succeeded).toBe(1)
      expect(result.totalEntries).toBe(1)
      expect(replayedEvents.length).toBe(1)
    })

    it('should return replay result with success/failure counts', async () => {
      let failCount = 0
      replayedEvents = []

      const handler = async (events: BatchEvent[]) => {
        if (failCount < 2) {
          failCount++
          throw new Error('Failure')
        }
        replayedEvents.push([...events])
      }

      batcher = createEventBatcher(
        {
          maxBatchSize: 1,
          flushIntervalMs: 60000,
          maxRetries: 0,
        },
        handler
      )

      // Create one failure
      await batcher.add(createMockEvent('evt_1'))
      await batcher.flush()

      // Replay will initially fail, then succeed on retry
      const result = await batcher.replay({ maxRetries: 2, retryDelayMs: 5 })

      expect(result.totalEntries).toBe(1)
      expect(result.succeeded).toBe(1)
      expect(result.failed).toBe(0)
    })

    it('should track replay duration', async () => {
      let shouldFail = true
      const handler = async () => {
        if (shouldFail) {
          throw new Error('Failure')
        }
        await delay(20) // Simulate some processing
      }

      batcher = createEventBatcher(
        {
          maxBatchSize: 100,
          flushIntervalMs: 60000,
          maxRetries: 0,
        },
        handler
      )

      await batcher.add(createMockEvent('evt_1'))
      await batcher.flush()

      shouldFail = false
      const result = await batcher.replay()

      expect(result.durationMs).toBeGreaterThan(0)
    })
  })

  describe('replay filtering', () => {
    it('should replay only entries matching specified IDs', async () => {
      let shouldFail = true
      replayedEvents = []

      const handler = async (events: BatchEvent[]) => {
        if (shouldFail) {
          throw new Error('Failure')
        }
        replayedEvents.push([...events])
      }

      batcher = createEventBatcher(
        {
          maxBatchSize: 1,
          flushIntervalMs: 60000,
          maxRetries: 0,
        },
        handler
      )

      await batcher.add(createMockEvent('evt_1'))
      await batcher.flush()
      await batcher.add(createMockEvent('evt_2'))
      await batcher.flush()
      await batcher.add(createMockEvent('evt_3'))
      await batcher.flush()

      const entries = batcher.getDeadLetterEntries()
      expect(entries.length).toBe(3)

      shouldFail = false
      const result = await batcher.replay({
        entryIds: [entries[0].id, entries[2].id],
      })

      expect(result.totalEntries).toBe(2)
      expect(result.succeeded).toBe(2)
      expect(replayedEvents.length).toBe(2)
    })

    it('should replay only entries matching error pattern', async () => {
      let errorType = 'network'
      replayedEvents = []

      const handler = async (events: BatchEvent[]) => {
        if (errorType) {
          const err = new Error(`${errorType}: Connection failed`)
          errorType = ''
          throw err
        }
        replayedEvents.push([...events])
      }

      batcher = createEventBatcher(
        {
          maxBatchSize: 1,
          flushIntervalMs: 60000,
          maxRetries: 0,
        },
        handler
      )

      // Create different types of errors
      errorType = 'network'
      await batcher.add(createMockEvent('evt_1'))
      await batcher.flush()

      errorType = 'validation'
      await batcher.add(createMockEvent('evt_2'))
      await batcher.flush()

      errorType = 'network'
      await batcher.add(createMockEvent('evt_3'))
      await batcher.flush()

      const result = await batcher.replay({
        errorPattern: /network/,
      })

      expect(result.totalEntries).toBe(2)
      expect(result.succeeded).toBe(2)
    })

    it('should replay only entries in time range', async () => {
      let shouldFail = true
      replayedEvents = []

      const handler = async (events: BatchEvent[]) => {
        if (shouldFail) {
          throw new Error('Failure')
        }
        replayedEvents.push([...events])
      }

      batcher = createEventBatcher(
        {
          maxBatchSize: 1,
          flushIntervalMs: 60000,
          maxRetries: 0,
        },
        handler
      )

      await batcher.add(createMockEvent('evt_1'))
      await batcher.flush()

      const midPoint = new Date()
      await delay(10)

      await batcher.add(createMockEvent('evt_2'))
      await batcher.flush()

      await batcher.add(createMockEvent('evt_3'))
      await batcher.flush()

      shouldFail = false
      const result = await batcher.replay({
        since: midPoint,
      })

      expect(result.totalEntries).toBe(2)
      expect(result.succeeded).toBe(2)
    })

    it('should limit number of entries to replay', async () => {
      let shouldFail = true
      replayedEvents = []

      const handler = async (events: BatchEvent[]) => {
        if (shouldFail) {
          throw new Error('Failure')
        }
        replayedEvents.push([...events])
      }

      batcher = createEventBatcher(
        {
          maxBatchSize: 1,
          flushIntervalMs: 60000,
          maxRetries: 0,
        },
        handler
      )

      // Create 5 failures
      for (let i = 0; i < 5; i++) {
        await batcher.add(createMockEvent(`evt_${i}`))
        await batcher.flush()
      }

      shouldFail = false
      const result = await batcher.replay({ limit: 2 })

      expect(result.totalEntries).toBe(2)
      expect(result.succeeded).toBe(2)
      expect(replayedEvents.length).toBe(2)
    })
  })

  describe('idempotent replay', () => {
    it('should not replay already successfully replayed entries', async () => {
      let shouldFail = true
      replayedEvents = []

      const handler = async (events: BatchEvent[]) => {
        if (shouldFail) {
          throw new Error('Failure')
        }
        replayedEvents.push([...events])
      }

      batcher = createEventBatcher(
        {
          maxBatchSize: 100,
          flushIntervalMs: 60000,
          maxRetries: 0,
        },
        handler
      )

      await batcher.add(createMockEvent('evt_1'))
      await batcher.flush()

      shouldFail = false

      // First replay
      const result1 = await batcher.replay()
      expect(result1.succeeded).toBe(1)

      // Second replay should skip
      const result2 = await batcher.replay()
      expect(result2.skipped).toBe(1)
      expect(result2.succeeded).toBe(0)
      expect(replayedEvents.length).toBe(1) // Only replayed once
    })

    it('should track replay success status in entry', async () => {
      let shouldFail = true

      const handler = async () => {
        if (shouldFail) {
          throw new Error('Failure')
        }
      }

      batcher = createEventBatcher(
        {
          maxBatchSize: 100,
          flushIntervalMs: 60000,
          maxRetries: 0,
        },
        handler
      )

      await batcher.add(createMockEvent('evt_1'))
      await batcher.flush()

      const entriesBefore = batcher.getDeadLetterEntries()
      expect(entriesBefore[0].replaySucceeded).toBeUndefined()

      shouldFail = false
      await batcher.replay()

      const entriesAfter = batcher.getDeadLetterEntries()
      expect(entriesAfter[0].replaySucceeded).toBe(true)
      expect(entriesAfter[0].replaySucceededAt).toBeDefined()
    })

    it('should track replay attempt count', async () => {
      const alwaysFailHandler = async () => {
        throw new Error('Failure')
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
      await batcher.flush()

      // Multiple replay attempts
      await batcher.replay({ maxRetries: 0, retryDelayMs: 5 })
      await batcher.replay({ maxRetries: 0, retryDelayMs: 5 })
      await batcher.replay({ maxRetries: 0, retryDelayMs: 5 })

      const entries = batcher.getDeadLetterEntries()
      expect(entries[0].replayAttempts).toBe(3)
    })
  })

  describe('replay options', () => {
    it('should use custom retry settings for replay', async () => {
      let attemptCount = 0
      replayedEvents = []

      const handler = async (events: BatchEvent[]) => {
        attemptCount++
        if (attemptCount <= 3) {
          throw new Error('Failure')
        }
        replayedEvents.push([...events])
      }

      batcher = createEventBatcher(
        {
          maxBatchSize: 100,
          flushIntervalMs: 60000,
          maxRetries: 0,
        },
        handler
      )

      await batcher.add(createMockEvent('evt_1'))
      await batcher.flush()

      // Reset counter and use more retries for replay
      attemptCount = 0
      const result = await batcher.replay({
        maxRetries: 5,
        retryDelayMs: 5,
      })

      expect(result.succeeded).toBe(1)
    })

    it('should clear successfully replayed entries when clearOnSuccess is true', async () => {
      let shouldFail = true

      const handler = async () => {
        if (shouldFail) {
          throw new Error('Failure')
        }
      }

      batcher = createEventBatcher(
        {
          maxBatchSize: 100,
          flushIntervalMs: 60000,
          maxRetries: 0,
        },
        handler
      )

      await batcher.add(createMockEvent('evt_1'))
      await batcher.flush()

      expect(batcher.getDeadLetterEntries().length).toBe(1)

      shouldFail = false
      await batcher.replay({ clearOnSuccess: true })

      expect(batcher.getDeadLetterEntries().length).toBe(0)
    })
  })
})

// ============================================================================
// CLEARING DEAD LETTER QUEUE
// ============================================================================

describe('Clearing Dead Letter Queue', () => {
  let batcher: EventBatcher

  afterEach(async () => {
    if (batcher && !batcher.isClosed) {
      await batcher.close()
    }
  })

  it('should clear all entries', async () => {
    const failingHandler = async () => {
      throw new Error('Failure')
    }

    batcher = createEventBatcher(
      {
        maxBatchSize: 1,
        flushIntervalMs: 60000,
        maxRetries: 0,
      },
      failingHandler
    )

    for (let i = 0; i < 3; i++) {
      await batcher.add(createMockEvent(`evt_${i}`))
      await batcher.flush()
    }

    expect(batcher.getDeadLetterEntries().length).toBe(3)

    const cleared = batcher.clearDeadLetterQueue({ all: true })
    expect(cleared).toBe(3)
    expect(batcher.getDeadLetterEntries().length).toBe(0)
  })

  it('should clear specific entries by ID', async () => {
    const failingHandler = async () => {
      throw new Error('Failure')
    }

    batcher = createEventBatcher(
      {
        maxBatchSize: 1,
        flushIntervalMs: 60000,
        maxRetries: 0,
      },
      failingHandler
    )

    for (let i = 0; i < 3; i++) {
      await batcher.add(createMockEvent(`evt_${i}`))
      await batcher.flush()
    }

    const entries = batcher.getDeadLetterEntries()
    const cleared = batcher.clearDeadLetterQueue({
      entryIds: [entries[0].id, entries[2].id],
    })

    expect(cleared).toBe(2)
    expect(batcher.getDeadLetterEntries().length).toBe(1)
    expect(batcher.getDeadLetterEntries()[0].id).toBe(entries[1].id)
  })

  it('should clear only successfully replayed entries', async () => {
    let shouldFail = true

    const handler = async () => {
      if (shouldFail) {
        throw new Error('Failure')
      }
    }

    batcher = createEventBatcher(
      {
        maxBatchSize: 1,
        flushIntervalMs: 60000,
        maxRetries: 0,
      },
      handler
    )

    for (let i = 0; i < 3; i++) {
      await batcher.add(createMockEvent(`evt_${i}`))
      await batcher.flush()
    }

    // Replay only the first two
    const entries = batcher.getDeadLetterEntries()
    shouldFail = false
    await batcher.replay({ entryIds: [entries[0].id, entries[1].id] })

    const cleared = batcher.clearDeadLetterQueue({ onlySuccessful: true })
    expect(cleared).toBe(2)
    expect(batcher.getDeadLetterEntries().length).toBe(1)
  })
})

// ============================================================================
// INTEGRATION WITH EVENT BATCHER
// ============================================================================

describe('EventBatcher Integration', () => {
  let batcher: EventBatcher
  let deliveredEvents: BatchEvent[][]

  afterEach(async () => {
    if (batcher && !batcher.isClosed) {
      await batcher.close()
    }
  })

  it('should integrate DLQ with normal batching flow', async () => {
    let failOnFirst = true
    deliveredEvents = []

    const handler = async (events: BatchEvent[]) => {
      if (failOnFirst) {
        failOnFirst = false
        throw new Error('Initial failure')
      }
      deliveredEvents.push([...events])
    }

    batcher = createEventBatcher(
      {
        maxBatchSize: 100,
        flushIntervalMs: 60000,
        maxRetries: 0,
      },
      handler
    )

    // First batch fails
    await batcher.add(createMockEvent('evt_1'))
    await batcher.add(createMockEvent('evt_2'))
    await batcher.flush()

    // Events should be in DLQ
    expect(batcher.getDeadLetterEntries().length).toBe(1)
    expect(deliveredEvents.length).toBe(0)

    // Second batch succeeds
    await batcher.add(createMockEvent('evt_3'))
    await batcher.flush()

    expect(deliveredEvents.length).toBe(1)
    expect(deliveredEvents[0][0].id).toBe('evt_3')

    // Replay DLQ
    await batcher.replay()

    expect(deliveredEvents.length).toBe(2)
    expect(batcher.getDeadLetterStats().replayedSuccessfully).toBe(1)
  })

  it('should preserve event ordering during replay', async () => {
    let shouldFail = true
    deliveredEvents = []

    const handler = async (events: BatchEvent[]) => {
      if (shouldFail) {
        throw new Error('Failure')
      }
      deliveredEvents.push([...events])
    }

    batcher = createEventBatcher(
      {
        maxBatchSize: 5,
        flushIntervalMs: 60000,
        maxRetries: 0,
      },
      handler
    )

    // Add events in order
    for (let i = 0; i < 5; i++) {
      await batcher.add(createMockEvent(`evt_${i}`))
    }
    await batcher.flush()

    shouldFail = false
    await batcher.replay()

    // Events should be in original order
    const replayedIds = deliveredEvents[0].map((e) => e.id)
    expect(replayedIds).toEqual(['evt_0', 'evt_1', 'evt_2', 'evt_3', 'evt_4'])
  })

  it('should handle concurrent flush and replay', async () => {
    let flushCallCount = 0
    deliveredEvents = []

    const handler = async (events: BatchEvent[]) => {
      flushCallCount++
      if (flushCallCount === 1) {
        throw new Error('First flush fails')
      }
      await delay(20) // Simulate slow handler
      deliveredEvents.push([...events])
    }

    batcher = createEventBatcher(
      {
        maxBatchSize: 100,
        flushIntervalMs: 60000,
        maxRetries: 0,
      },
      handler
    )

    // First batch fails
    await batcher.add(createMockEvent('evt_1'))
    await batcher.flush()

    // Start replay and new flush concurrently
    await batcher.add(createMockEvent('evt_2'))
    const [replayResult, flushResult] = await Promise.all([
      batcher.replay(),
      batcher.flush(),
    ])

    expect(replayResult.succeeded).toBe(1)
    expect(flushResult.success).toBe(true)
    expect(deliveredEvents.length).toBe(2)
  })
})
