/**
 * Pipeline Failure Resilience Tests - TDD RED Phase
 *
 * These tests define the expected behavior of the unified storage system
 * when the Pipeline (event streaming) fails. The system should:
 *
 * 1. Continue accepting writes locally even when Pipeline is down
 * 2. Queue events for retry when Pipeline fails (no data loss)
 * 3. Send events to DLQ after max retries exhausted
 * 4. Notify clients/health checks of degraded mode
 * 5. Replay queued events when Pipeline is restored
 * 6. Preserve event order during retry (FIFO)
 * 7. Apply backpressure when retry queue grows too large
 *
 * NOTE: These tests are designed to FAIL because the resilient implementation
 * does not exist yet. This is the TDD RED phase.
 *
 * @see /objects/unified-storage/pipeline-emitter.ts
 * @see /objects/unified-storage/resilient-pipeline-emitter.ts (to be created)
 * @module tests/unified-storage/chaos/pipeline-failure.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Import from the existing module - these tests expect NEW resilience features
import {
  PipelineEmitter,
  type PipelineEmitterConfig,
  type EmittedEvent,
} from '../../../objects/unified-storage/pipeline-emitter'

// Types for the resilient features to be implemented
import type { Pipeline } from '../../../objects/unified-storage/types/pipeline'

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

interface MockPipelineOptions {
  sendDelayMs?: number
  errorOnSend?: Error | null
  failCount?: number
  permanentFailure?: boolean
}

/**
 * Create a mock Pipeline that can simulate various failure modes
 */
const createMockPipeline = (options: MockPipelineOptions = {}) => {
  const events: unknown[] = []
  let delay = options.sendDelayMs ?? 0
  let error = options.errorOnSend ?? null
  let failuresRemaining = options.failCount ?? 0
  let permanentFailure = options.permanentFailure ?? false
  let isDown = false

  const send = vi.fn(async (batch: unknown[]) => {
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
    if (permanentFailure || isDown) {
      throw error || new Error('Pipeline is down')
    }
    if (failuresRemaining > 0) {
      failuresRemaining--
      throw error || new Error('Mock pipeline failure')
    }
    if (error) {
      throw error
    }
    events.push(...batch)
  })

  return {
    send,
    events,
    setDelay: (ms: number) => {
      delay = ms
    },
    setError: (err: Error | null) => {
      error = err
    },
    setFailCount: (count: number) => {
      failuresRemaining = count
    },
    setPermanentFailure: (fail: boolean) => {
      permanentFailure = fail
    },
    setDown: (down: boolean) => {
      isDown = down
    },
    restore: () => {
      isDown = false
      permanentFailure = false
      error = null
      failuresRemaining = 0
    },
    clear: () => {
      events.length = 0
      send.mockClear()
    },
  }
}

type MockPipeline = ReturnType<typeof createMockPipeline>

/**
 * Create a mock Dead-Letter Queue
 */
const createMockDeadLetter = () => {
  const events: unknown[] = []
  const send = vi.fn(async (batch: unknown[]) => {
    events.push(...batch)
  })

  return {
    send,
    events,
    clear: () => {
      events.length = 0
      send.mockClear()
    },
  }
}

type MockDeadLetter = ReturnType<typeof createMockDeadLetter>

/**
 * Create a mock local storage (simulating SQLite persistence)
 */
const createMockLocalStorage = () => {
  const data = new Map<string, unknown>()
  return {
    put: vi.fn(async (key: string, value: unknown) => {
      data.set(key, value)
    }),
    get: vi.fn(async <T>(key: string): Promise<T | undefined> => {
      return data.get(key) as T | undefined
    }),
    delete: vi.fn(async (key: string) => {
      return data.delete(key)
    }),
    list: vi.fn(async () => new Map(data)),
    data,
    clear: () => {
      data.clear()
    },
  }
}

type MockLocalStorage = ReturnType<typeof createMockLocalStorage>

/**
 * Create a mock health check callback
 */
const createMockHealthCallback = () => {
  const statusHistory: Array<{ status: string; timestamp: number }> = []
  return {
    onStatusChange: vi.fn((status: string) => {
      statusHistory.push({ status, timestamp: Date.now() })
    }),
    statusHistory,
    getLatestStatus: () => statusHistory[statusHistory.length - 1]?.status,
  }
}

type MockHealthCallback = ReturnType<typeof createMockHealthCallback>

// ============================================================================
// TESTS
// ============================================================================

describe('Pipeline Failure Resilience', () => {
  let mockPipeline: MockPipeline
  let mockDeadLetter: MockDeadLetter
  let mockLocalStorage: MockLocalStorage
  let mockHealthCallback: MockHealthCallback
  let emitter: PipelineEmitter

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-14T12:00:00.000Z'))
    mockPipeline = createMockPipeline()
    mockDeadLetter = createMockDeadLetter()
    mockLocalStorage = createMockLocalStorage()
    mockHealthCallback = createMockHealthCallback()
  })

  afterEach(async () => {
    if (emitter) {
      await emitter.close()
    }
    vi.useRealTimers()
  })

  // ============================================================================
  // TEST 1: WRITE SUCCEEDS LOCALLY EVEN WHEN PIPELINE FAILS
  // ============================================================================

  describe('Local Write Success During Pipeline Failure', () => {
    it('should accept writes locally even when Pipeline is completely down', async () => {
      // Pipeline is down from the start
      mockPipeline.setDown(true)

      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 0,
        maxRetries: 3,
        retryDelay: 100,
      })

      // Write should not throw - it should be queued locally
      const writePromise = new Promise<void>((resolve, reject) => {
        try {
          emitter.emit('thing.created', 'things', { $id: 'thing-123', name: 'Alice' })
          resolve()
        } catch (e) {
          reject(e)
        }
      })

      // Emit should succeed immediately (fire-and-forget)
      await expect(writePromise).resolves.not.toThrow()

      // The event should be queued for retry
      // @ts-expect-error - accessing internal retryQueue property (to be implemented)
      expect(emitter.retryQueue?.length).toBeGreaterThan(0)
    })

    it('should continue processing new writes while retrying failed ones', async () => {
      mockPipeline.setFailCount(3) // First 3 attempts fail

      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 0,
        maxRetries: 5,
        retryDelay: 100,
      })

      // First write - will fail and retry
      emitter.emit('thing.created', 'things', { $id: 'thing-1', name: 'Alice' })

      // Advance timers to start retry
      await vi.advanceTimersByTimeAsync(50)

      // Second write - should be accepted even while first is retrying
      emitter.emit('thing.created', 'things', { $id: 'thing-2', name: 'Bob' })

      // Advance time to complete all retries
      await vi.advanceTimersByTimeAsync(500)

      // Both events should eventually succeed
      expect(mockPipeline.events).toHaveLength(2)
    })

    it('should isolate Pipeline failures from local state updates', async () => {
      mockPipeline.setPermanentFailure(true)

      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 0,
        maxRetries: 2,
        retryDelay: 10,
        deadLetterQueue: mockDeadLetter as any,
      })

      // Multiple writes during outage
      emitter.emit('thing.created', 'things', { $id: 'thing-1', name: 'Alice' })
      emitter.emit('thing.created', 'things', { $id: 'thing-2', name: 'Bob' })
      emitter.emit('thing.created', 'things', { $id: 'thing-3', name: 'Charlie' })

      // Allow retries to exhaust
      await vi.advanceTimersByTimeAsync(200)

      // Events should be in DLQ, not lost
      expect(mockDeadLetter.events.length).toBe(3)

      // Pipeline events array should be empty (permanent failure)
      expect(mockPipeline.events).toHaveLength(0)
    })
  })

  // ============================================================================
  // TEST 2: EVENTS QUEUED FOR RETRY ON PIPELINE FAILURE (NOT LOST)
  // ============================================================================

  describe('Event Queueing and Retry', () => {
    it('should queue events in retry buffer when Pipeline fails', async () => {
      mockPipeline.setDown(true)

      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 0,
        maxRetries: 5,
        retryDelay: 1000,
      })

      // Emit events during outage
      emitter.emit('thing.created', 'things', { $id: 'thing-1', name: 'Alice' })
      emitter.emit('thing.updated', 'things', { $id: 'thing-1', name: 'Alice Updated' })

      await vi.advanceTimersByTimeAsync(100)

      // Events should be in the retry queue
      // @ts-expect-error - accessing internal retryQueue property (to be implemented)
      const retryQueue = emitter.retryQueue
      expect(retryQueue).toBeDefined()
      expect(retryQueue?.length).toBe(2)
    })

    it('should persist retry queue to local storage for durability', async () => {
      mockPipeline.setDown(true)

      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 0,
        maxRetries: 5,
        retryDelay: 1000,
        // @ts-expect-error - new config option to be implemented
        localStorage: mockLocalStorage,
      })

      emitter.emit('thing.created', 'things', { $id: 'thing-1', name: 'Alice' })
      await vi.advanceTimersByTimeAsync(100)

      // Retry queue should be persisted
      expect(mockLocalStorage.put).toHaveBeenCalledWith(
        expect.stringContaining('retry_queue'),
        expect.any(String)
      )
    })

    it('should restore retry queue from local storage on restart', async () => {
      // Pre-populate local storage with queued events
      const queuedEvents = [
        {
          verb: 'thing.created',
          store: 'things',
          payload: { $id: 'thing-1', name: 'Alice' },
          timestamp: '2026-01-14T11:00:00.000Z',
          idempotencyKey: 'thing-1:created:1736852400000',
          _meta: { namespace: 'test-ns' },
          retryCount: 2,
        },
      ]
      mockLocalStorage.data.set('pipeline_retry_queue', JSON.stringify(queuedEvents))

      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 0,
        maxRetries: 5,
        retryDelay: 100,
        // @ts-expect-error - new config option to be implemented
        localStorage: mockLocalStorage,
      })

      // Allow initialization
      await vi.advanceTimersByTimeAsync(200)

      // Events should be replayed from stored queue
      expect(mockPipeline.send).toHaveBeenCalled()
      expect(mockPipeline.events).toHaveLength(1)
    })

    it('should track retry count per event', async () => {
      mockPipeline.setFailCount(3)

      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 0,
        maxRetries: 5,
        retryDelay: 100,
      })

      emitter.emit('thing.created', 'things', { $id: 'thing-1', name: 'Alice' })

      // Advance through retries
      await vi.advanceTimersByTimeAsync(500)

      // Should have attempted 4 times (1 initial + 3 retries before success)
      expect(mockPipeline.send).toHaveBeenCalledTimes(4)
    })

    it('should use exponential backoff for retries', async () => {
      const callTimes: number[] = []
      mockPipeline.send.mockImplementation(async () => {
        callTimes.push(Date.now())
        throw new Error('Fail')
      })

      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 0,
        maxRetries: 4,
        retryDelay: 100,
        exponentialBackoff: true,
      })

      emitter.emit('thing.created', 'things', { $id: 'thing-1', name: 'Alice' })

      // Advance time through all retries: 100 + 200 + 400 = 700ms minimum
      await vi.advanceTimersByTimeAsync(1000)

      // Verify exponential delays between attempts
      expect(callTimes.length).toBe(4)
      if (callTimes.length >= 3) {
        const delay1 = callTimes[1] - callTimes[0]
        const delay2 = callTimes[2] - callTimes[1]
        // Each delay should be roughly double the previous
        expect(delay2).toBeGreaterThanOrEqual(delay1 * 1.5)
      }
    })
  })

  // ============================================================================
  // TEST 3: DLQ RECEIVES EVENTS AFTER MAX RETRIES EXHAUSTED
  // ============================================================================

  describe('Dead-Letter Queue Handling', () => {
    it('should send events to DLQ after max retries exhausted', async () => {
      mockPipeline.setPermanentFailure(true)

      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 0,
        maxRetries: 3,
        retryDelay: 50,
        deadLetterQueue: mockDeadLetter as any,
      })

      emitter.emit('thing.created', 'things', { $id: 'thing-1', name: 'Alice' })

      // Allow all retries to exhaust
      await vi.advanceTimersByTimeAsync(500)

      // Should have been sent to DLQ
      expect(mockDeadLetter.send).toHaveBeenCalledTimes(1)
      expect(mockDeadLetter.events).toHaveLength(1)
    })

    it('should include retry metadata in DLQ events', async () => {
      mockPipeline.setPermanentFailure(true)

      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 0,
        maxRetries: 3,
        retryDelay: 50,
        deadLetterQueue: mockDeadLetter as any,
      })

      emitter.emit('thing.created', 'things', { $id: 'thing-1', name: 'Alice' })
      await vi.advanceTimersByTimeAsync(500)

      const dlqEvent = mockDeadLetter.events[0] as any
      // @ts-expect-error - expecting new _dlq metadata (to be implemented)
      expect(dlqEvent._dlq).toBeDefined()
      // @ts-expect-error - expecting retry count metadata
      expect(dlqEvent._dlq.retryCount).toBe(3)
      // @ts-expect-error - expecting last error metadata
      expect(dlqEvent._dlq.lastError).toBeDefined()
      // @ts-expect-error - expecting timestamp metadata
      expect(dlqEvent._dlq.failedAt).toBeDefined()
    })

    it('should not lose events even without DLQ configured', async () => {
      mockPipeline.setPermanentFailure(true)

      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 0,
        maxRetries: 2,
        retryDelay: 50,
        // No deadLetterQueue configured
      })

      emitter.emit('thing.created', 'things', { $id: 'thing-1', name: 'Alice' })
      await vi.advanceTimersByTimeAsync(300)

      // Events should be stored in a fallback location
      // @ts-expect-error - accessing internal failedEvents property (to be implemented)
      expect(emitter.failedEvents?.length).toBeGreaterThan(0)
    })

    it('should batch DLQ sends for efficiency', async () => {
      mockPipeline.setPermanentFailure(true)

      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 0,
        maxRetries: 2,
        retryDelay: 10,
        deadLetterQueue: mockDeadLetter as any,
      })

      // Emit multiple events
      emitter.emit('thing.created', 'things', { $id: 'thing-1', name: 'Alice' })
      emitter.emit('thing.created', 'things', { $id: 'thing-2', name: 'Bob' })
      emitter.emit('thing.created', 'things', { $id: 'thing-3', name: 'Charlie' })

      await vi.advanceTimersByTimeAsync(200)

      // All 3 events in DLQ
      expect(mockDeadLetter.events).toHaveLength(3)
      // Should batch DLQ sends (1 or 2 calls, not 3)
      expect(mockDeadLetter.send.mock.calls.length).toBeLessThanOrEqual(2)
    })

    it('should handle DLQ failures gracefully', async () => {
      mockPipeline.setPermanentFailure(true)
      mockDeadLetter.send.mockRejectedValue(new Error('DLQ also down'))

      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 0,
        maxRetries: 2,
        retryDelay: 10,
        deadLetterQueue: mockDeadLetter as any,
      })

      emitter.emit('thing.created', 'things', { $id: 'thing-1', name: 'Alice' })
      await vi.advanceTimersByTimeAsync(200)

      // Should not throw, should store locally
      // @ts-expect-error - accessing internal failedEvents property (to be implemented)
      expect(emitter.failedEvents?.length).toBeGreaterThan(0)
    })
  })

  // ============================================================================
  // TEST 4: CLIENT/HEALTH CHECK NOTIFIED OF DEGRADED MODE
  // ============================================================================

  describe('Degraded Mode Notification', () => {
    it('should notify health callback when Pipeline enters degraded state', async () => {
      mockPipeline.setDown(true)

      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 0,
        maxRetries: 3,
        retryDelay: 100,
        // @ts-expect-error - new config option to be implemented
        onHealthChange: mockHealthCallback.onStatusChange,
      })

      emitter.emit('thing.created', 'things', { $id: 'thing-1', name: 'Alice' })
      await vi.advanceTimersByTimeAsync(150)

      expect(mockHealthCallback.onStatusChange).toHaveBeenCalledWith('degraded')
    })

    it('should expose degraded status via getter', async () => {
      mockPipeline.setDown(true)

      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 0,
        maxRetries: 2,
        retryDelay: 50,
      })

      emitter.emit('thing.created', 'things', { $id: 'thing-1', name: 'Alice' })
      await vi.advanceTimersByTimeAsync(100)

      // @ts-expect-error - new property to be implemented
      expect(emitter.isDegraded).toBe(true)
      // @ts-expect-error - new property to be implemented
      expect(emitter.healthStatus).toBe('degraded')
    })

    it('should notify when recovering from degraded state', async () => {
      mockPipeline.setDown(true)

      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 0,
        maxRetries: 5,
        retryDelay: 100,
        // @ts-expect-error - new config option to be implemented
        onHealthChange: mockHealthCallback.onStatusChange,
      })

      emitter.emit('thing.created', 'things', { $id: 'thing-1', name: 'Alice' })
      await vi.advanceTimersByTimeAsync(200)

      // Should be degraded
      expect(mockHealthCallback.getLatestStatus()).toBe('degraded')

      // Restore pipeline
      mockPipeline.restore()
      await vi.advanceTimersByTimeAsync(200)

      // Should recover
      expect(mockHealthCallback.onStatusChange).toHaveBeenCalledWith('healthy')
    })

    it('should include degradation details in health status', async () => {
      mockPipeline.setFailCount(5)

      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 0,
        maxRetries: 10,
        retryDelay: 50,
      })

      emitter.emit('thing.created', 'things', { $id: 'thing-1', name: 'Alice' })
      await vi.advanceTimersByTimeAsync(200)

      // @ts-expect-error - new property to be implemented
      const healthDetails = emitter.getHealthDetails()
      expect(healthDetails).toBeDefined()
      expect(healthDetails.retryQueueSize).toBeGreaterThan(0)
      expect(healthDetails.consecutiveFailures).toBeGreaterThan(0)
      expect(healthDetails.lastError).toBeDefined()
    })

    it('should track time in degraded state', async () => {
      mockPipeline.setDown(true)

      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 0,
        maxRetries: 3,
        retryDelay: 100,
      })

      emitter.emit('thing.created', 'things', { $id: 'thing-1', name: 'Alice' })
      await vi.advanceTimersByTimeAsync(500)

      // @ts-expect-error - new property to be implemented
      const healthDetails = emitter.getHealthDetails()
      expect(healthDetails.degradedSinceMs).toBeDefined()
      expect(healthDetails.degradedDurationMs).toBeGreaterThanOrEqual(400)
    })
  })

  // ============================================================================
  // TEST 5: EVENTS REPLAYED WHEN PIPELINE IS RESTORED
  // ============================================================================

  describe('Event Replay on Recovery', () => {
    it('should replay queued events when Pipeline recovers', async () => {
      mockPipeline.setDown(true)

      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 0,
        maxRetries: 10,
        retryDelay: 100,
      })

      // Queue events during outage
      emitter.emit('thing.created', 'things', { $id: 'thing-1', name: 'Alice' })
      emitter.emit('thing.created', 'things', { $id: 'thing-2', name: 'Bob' })

      await vi.advanceTimersByTimeAsync(200)

      // Events should be queued, not delivered
      expect(mockPipeline.events).toHaveLength(0)

      // Restore pipeline
      mockPipeline.restore()
      await vi.advanceTimersByTimeAsync(200)

      // Events should be replayed
      expect(mockPipeline.events).toHaveLength(2)
    })

    it('should replay events in original order (FIFO)', async () => {
      mockPipeline.setDown(true)

      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 0,
        maxRetries: 10,
        retryDelay: 100,
      })

      // Queue events in specific order
      emitter.emit('thing.created', 'things', { $id: 'thing-1', name: 'First' })
      await vi.advanceTimersByTimeAsync(10)
      emitter.emit('thing.created', 'things', { $id: 'thing-2', name: 'Second' })
      await vi.advanceTimersByTimeAsync(10)
      emitter.emit('thing.created', 'things', { $id: 'thing-3', name: 'Third' })

      await vi.advanceTimersByTimeAsync(200)

      // Restore pipeline
      mockPipeline.restore()
      await vi.advanceTimersByTimeAsync(300)

      // Events should be delivered in FIFO order
      const events = mockPipeline.events as EmittedEvent[]
      expect(events).toHaveLength(3)
      expect((events[0].payload as any).name).toBe('First')
      expect((events[1].payload as any).name).toBe('Second')
      expect((events[2].payload as any).name).toBe('Third')
    })

    it('should not duplicate events during replay', async () => {
      mockPipeline.setFailCount(2)

      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 0,
        maxRetries: 5,
        retryDelay: 50,
      })

      emitter.emit('thing.created', 'things', { $id: 'thing-1', name: 'Alice' })
      await vi.advanceTimersByTimeAsync(500)

      // Should only have 1 event, not duplicated
      const events = mockPipeline.events as EmittedEvent[]
      const uniqueKeys = new Set(events.map((e) => e.idempotencyKey))
      expect(uniqueKeys.size).toBe(events.length)
    })

    it('should clear retry queue after successful replay', async () => {
      mockPipeline.setFailCount(2)

      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 0,
        maxRetries: 5,
        retryDelay: 50,
      })

      emitter.emit('thing.created', 'things', { $id: 'thing-1', name: 'Alice' })
      await vi.advanceTimersByTimeAsync(500)

      // @ts-expect-error - accessing internal retryQueue property (to be implemented)
      expect(emitter.retryQueue?.length ?? 0).toBe(0)
    })

    it('should continue processing new events while replaying', async () => {
      mockPipeline.setDown(true)

      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 0,
        maxRetries: 10,
        retryDelay: 100,
      })

      // Queue initial events
      emitter.emit('thing.created', 'things', { $id: 'thing-1', name: 'Queued' })
      await vi.advanceTimersByTimeAsync(150)

      // Restore pipeline
      mockPipeline.restore()

      // Emit new event during replay
      emitter.emit('thing.created', 'things', { $id: 'thing-2', name: 'NewDuringReplay' })

      await vi.advanceTimersByTimeAsync(300)

      // Both events should be delivered
      expect(mockPipeline.events).toHaveLength(2)
    })
  })

  // ============================================================================
  // TEST 6: NO DATA LOSS DURING PIPELINE OUTAGE
  // ============================================================================

  describe('Zero Data Loss Guarantee', () => {
    it('should not lose any events during complete Pipeline outage', async () => {
      mockPipeline.setDown(true)

      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 0,
        maxRetries: 100, // High retry count
        retryDelay: 50,
      })

      // Emit many events during outage
      const eventCount = 100
      for (let i = 0; i < eventCount; i++) {
        emitter.emit('thing.created', 'things', { $id: `thing-${i}`, index: i })
      }

      await vi.advanceTimersByTimeAsync(500)

      // No events delivered yet
      expect(mockPipeline.events).toHaveLength(0)

      // All events should be queued
      // @ts-expect-error - accessing internal retryQueue property (to be implemented)
      expect(emitter.retryQueue?.length ?? 0).toBe(eventCount)

      // Restore pipeline
      mockPipeline.restore()
      await vi.advanceTimersByTimeAsync(1000)

      // All events should be delivered
      expect(mockPipeline.events).toHaveLength(eventCount)
    })

    it('should persist events to durable storage during outage', async () => {
      mockPipeline.setDown(true)

      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 0,
        maxRetries: 10,
        retryDelay: 100,
        // @ts-expect-error - new config option to be implemented
        localStorage: mockLocalStorage,
        persistRetryQueue: true,
      })

      emitter.emit('thing.created', 'things', { $id: 'thing-1', name: 'Important' })
      await vi.advanceTimersByTimeAsync(200)

      // Event should be persisted to local storage
      const storedQueue = mockLocalStorage.data.get('pipeline_retry_queue')
      expect(storedQueue).toBeDefined()
      const parsed = JSON.parse(storedQueue as string)
      expect(parsed.length).toBe(1)
    })

    it('should recover persisted events after crash/restart', async () => {
      // Simulate a crash with persisted events
      const persistedEvents = [
        {
          verb: 'thing.created',
          store: 'things',
          payload: { $id: 'thing-1', name: 'Persisted1' },
          timestamp: '2026-01-14T11:00:00.000Z',
          idempotencyKey: 'thing-1:created:1736852400000',
          _meta: { namespace: 'test-ns' },
        },
        {
          verb: 'thing.created',
          store: 'things',
          payload: { $id: 'thing-2', name: 'Persisted2' },
          timestamp: '2026-01-14T11:01:00.000Z',
          idempotencyKey: 'thing-2:created:1736852460000',
          _meta: { namespace: 'test-ns' },
        },
      ]
      mockLocalStorage.data.set('pipeline_retry_queue', JSON.stringify(persistedEvents))

      // Create new emitter (simulating restart)
      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 0,
        maxRetries: 5,
        retryDelay: 50,
        // @ts-expect-error - new config option to be implemented
        localStorage: mockLocalStorage,
      })

      await vi.advanceTimersByTimeAsync(200)

      // Persisted events should be recovered and sent
      expect(mockPipeline.events).toHaveLength(2)
    })

    it('should handle partial failures without losing successful events', async () => {
      // First event succeeds, second fails
      let callCount = 0
      mockPipeline.send.mockImplementation(async (batch: unknown[]) => {
        callCount++
        if (callCount === 1) {
          // First call succeeds
          mockPipeline.events.push(...batch)
        } else if (callCount < 5) {
          // Next few calls fail
          throw new Error('Partial failure')
        } else {
          // Eventually succeeds
          mockPipeline.events.push(...batch)
        }
      })

      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 100,
        batchSize: 1, // Force separate batches
        maxRetries: 5,
        retryDelay: 50,
      })

      emitter.emit('thing.created', 'things', { $id: 'thing-1', name: 'First' })
      await vi.advanceTimersByTimeAsync(50)

      emitter.emit('thing.created', 'things', { $id: 'thing-2', name: 'Second' })
      await vi.advanceTimersByTimeAsync(500)

      // Both should eventually succeed
      expect(mockPipeline.events).toHaveLength(2)
    })
  })

  // ============================================================================
  // TEST 7: ORDER PRESERVED DURING RETRY (FIFO)
  // ============================================================================

  describe('Event Order Preservation (FIFO)', () => {
    it('should maintain strict FIFO order for retried events', async () => {
      mockPipeline.setFailCount(3)

      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 0,
        maxRetries: 5,
        retryDelay: 50,
      })

      // Emit events with explicit ordering
      emitter.emit('thing.created', 'things', { $id: 'thing-1', order: 1 })
      emitter.emit('thing.created', 'things', { $id: 'thing-2', order: 2 })
      emitter.emit('thing.created', 'things', { $id: 'thing-3', order: 3 })
      emitter.emit('thing.created', 'things', { $id: 'thing-4', order: 4 })
      emitter.emit('thing.created', 'things', { $id: 'thing-5', order: 5 })

      await vi.advanceTimersByTimeAsync(500)

      // Verify order
      const events = mockPipeline.events as EmittedEvent[]
      expect(events).toHaveLength(5)
      for (let i = 0; i < events.length; i++) {
        expect((events[i].payload as any).order).toBe(i + 1)
      }
    })

    it('should not reorder events between batches', async () => {
      mockPipeline.setFailCount(2)

      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 50,
        batchSize: 3,
        maxRetries: 5,
        retryDelay: 30,
      })

      // First batch
      emitter.emit('thing.created', 'things', { $id: 'thing-1', batch: 1, order: 1 })
      emitter.emit('thing.created', 'things', { $id: 'thing-2', batch: 1, order: 2 })
      emitter.emit('thing.created', 'things', { $id: 'thing-3', batch: 1, order: 3 })

      await vi.advanceTimersByTimeAsync(100)

      // Second batch
      emitter.emit('thing.created', 'things', { $id: 'thing-4', batch: 2, order: 4 })
      emitter.emit('thing.created', 'things', { $id: 'thing-5', batch: 2, order: 5 })
      emitter.emit('thing.created', 'things', { $id: 'thing-6', batch: 2, order: 6 })

      await vi.advanceTimersByTimeAsync(500)

      // Verify order is maintained across batches
      const events = mockPipeline.events as EmittedEvent[]
      const orders = events.map((e) => (e.payload as any).order)
      expect(orders).toEqual([1, 2, 3, 4, 5, 6])
    })

    it('should preserve order when mixing successful and failed sends', async () => {
      // Alternate success/failure
      let callCount = 0
      mockPipeline.send.mockImplementation(async (batch: unknown[]) => {
        callCount++
        if (callCount % 2 === 0) {
          throw new Error('Alternating failure')
        }
        mockPipeline.events.push(...batch)
      })

      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 0,
        batchSize: 1,
        maxRetries: 10,
        retryDelay: 20,
      })

      for (let i = 1; i <= 5; i++) {
        emitter.emit('thing.created', 'things', { $id: `thing-${i}`, order: i })
        await vi.advanceTimersByTimeAsync(100)
      }

      // Eventually all should succeed
      await vi.advanceTimersByTimeAsync(1000)

      const events = mockPipeline.events as EmittedEvent[]
      expect(events.length).toBeGreaterThanOrEqual(5)

      // Verify chronological order
      for (let i = 0; i < events.length - 1; i++) {
        const currentOrder = (events[i].payload as any).order
        const nextOrder = (events[i + 1].payload as any).order
        expect(currentOrder).toBeLessThanOrEqual(nextOrder)
      }
    })

    it('should use sequence numbers for ordering guarantees', async () => {
      mockPipeline.setDown(true)

      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 0,
        maxRetries: 10,
        retryDelay: 50,
      })

      emitter.emit('thing.created', 'things', { $id: 'thing-1' })
      emitter.emit('thing.created', 'things', { $id: 'thing-2' })
      emitter.emit('thing.created', 'things', { $id: 'thing-3' })

      await vi.advanceTimersByTimeAsync(100)

      mockPipeline.restore()
      await vi.advanceTimersByTimeAsync(200)

      // Events should have sequence numbers
      const events = mockPipeline.events as EmittedEvent[]
      expect(events).toHaveLength(3)
      // @ts-expect-error - expecting _seq metadata (to be implemented)
      expect(events[0]._seq).toBeLessThan(events[1]._seq)
      // @ts-expect-error - expecting _seq metadata
      expect(events[1]._seq).toBeLessThan(events[2]._seq)
    })
  })

  // ============================================================================
  // TEST 8: BACKPRESSURE WHEN RETRY QUEUE GROWS TOO LARGE
  // ============================================================================

  describe('Backpressure Management', () => {
    it('should apply backpressure when retry queue exceeds threshold', async () => {
      mockPipeline.setDown(true)

      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 0,
        maxRetries: 100,
        retryDelay: 100,
        // @ts-expect-error - new config option to be implemented
        maxRetryQueueSize: 10,
      })

      // Fill up the retry queue
      for (let i = 0; i < 15; i++) {
        emitter.emit('thing.created', 'things', { $id: `thing-${i}`, index: i })
      }

      await vi.advanceTimersByTimeAsync(200)

      // Backpressure should be applied
      // @ts-expect-error - new property to be implemented
      expect(emitter.isBackpressured).toBe(true)
    })

    it('should reject new events when backpressure is active', async () => {
      mockPipeline.setDown(true)

      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 0,
        maxRetries: 100,
        retryDelay: 100,
        // @ts-expect-error - new config option to be implemented
        maxRetryQueueSize: 5,
        rejectOnBackpressure: true,
      })

      // Fill the queue
      for (let i = 0; i < 5; i++) {
        emitter.emit('thing.created', 'things', { $id: `thing-${i}` })
      }

      await vi.advanceTimersByTimeAsync(100)

      // @ts-expect-error - new method to be implemented
      const accepted = emitter.tryEmit('thing.created', 'things', { $id: 'thing-overflow' })
      expect(accepted).toBe(false)
    })

    it('should release backpressure when queue drains', async () => {
      mockPipeline.setDown(true)

      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 0,
        maxRetries: 100,
        retryDelay: 50,
        // @ts-expect-error - new config option to be implemented
        maxRetryQueueSize: 5,
      })

      // Fill the queue
      for (let i = 0; i < 8; i++) {
        emitter.emit('thing.created', 'things', { $id: `thing-${i}` })
      }

      await vi.advanceTimersByTimeAsync(100)
      // @ts-expect-error - new property to be implemented
      expect(emitter.isBackpressured).toBe(true)

      // Restore pipeline - queue should drain
      mockPipeline.restore()
      await vi.advanceTimersByTimeAsync(500)

      // @ts-expect-error - new property to be implemented
      expect(emitter.isBackpressured).toBe(false)
    })

    it('should notify when backpressure state changes', async () => {
      mockPipeline.setDown(true)

      const backpressureCallbacks: boolean[] = []

      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 0,
        maxRetries: 100,
        retryDelay: 50,
        // @ts-expect-error - new config option to be implemented
        maxRetryQueueSize: 3,
        onBackpressureChange: (active: boolean) => {
          backpressureCallbacks.push(active)
        },
      })

      // Trigger backpressure
      for (let i = 0; i < 5; i++) {
        emitter.emit('thing.created', 'things', { $id: `thing-${i}` })
      }

      await vi.advanceTimersByTimeAsync(100)
      expect(backpressureCallbacks).toContain(true)

      // Restore and drain
      mockPipeline.restore()
      await vi.advanceTimersByTimeAsync(500)

      expect(backpressureCallbacks).toContain(false)
    })

    it('should expose retry queue metrics', async () => {
      mockPipeline.setDown(true)

      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 0,
        maxRetries: 100,
        retryDelay: 100,
        // @ts-expect-error - new config option to be implemented
        maxRetryQueueSize: 100,
      })

      for (let i = 0; i < 20; i++) {
        emitter.emit('thing.created', 'things', { $id: `thing-${i}` })
      }

      await vi.advanceTimersByTimeAsync(200)

      // @ts-expect-error - new property to be implemented
      const queueMetrics = emitter.getRetryQueueMetrics()
      expect(queueMetrics).toBeDefined()
      expect(queueMetrics.size).toBe(20)
      expect(queueMetrics.maxSize).toBe(100)
      expect(queueMetrics.utilizationPercent).toBe(20)
    })

    it('should prioritize older events when queue is full (drop newest)', async () => {
      mockPipeline.setDown(true)

      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 0,
        maxRetries: 100,
        retryDelay: 100,
        // @ts-expect-error - new config options to be implemented
        maxRetryQueueSize: 5,
        overflowPolicy: 'drop-newest',
      })

      // Emit more than queue can hold
      for (let i = 1; i <= 10; i++) {
        emitter.emit('thing.created', 'things', { $id: `thing-${i}`, order: i })
      }

      await vi.advanceTimersByTimeAsync(100)

      // Restore pipeline
      mockPipeline.restore()
      await vi.advanceTimersByTimeAsync(500)

      // Should have oldest 5 events (1-5)
      const events = mockPipeline.events as EmittedEvent[]
      expect(events).toHaveLength(5)

      const orders = events.map((e) => (e.payload as any).order)
      expect(Math.max(...orders)).toBeLessThanOrEqual(5)
    })

    it('should support drop-oldest overflow policy', async () => {
      mockPipeline.setDown(true)

      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 0,
        maxRetries: 100,
        retryDelay: 100,
        // @ts-expect-error - new config options to be implemented
        maxRetryQueueSize: 5,
        overflowPolicy: 'drop-oldest',
      })

      // Emit more than queue can hold
      for (let i = 1; i <= 10; i++) {
        emitter.emit('thing.created', 'things', { $id: `thing-${i}`, order: i })
      }

      await vi.advanceTimersByTimeAsync(100)

      // Restore pipeline
      mockPipeline.restore()
      await vi.advanceTimersByTimeAsync(500)

      // Should have newest 5 events (6-10)
      const events = mockPipeline.events as EmittedEvent[]
      expect(events).toHaveLength(5)

      const orders = events.map((e) => (e.payload as any).order)
      expect(Math.min(...orders)).toBeGreaterThanOrEqual(6)
    })
  })

  // ============================================================================
  // INTEGRATION SCENARIO TESTS
  // ============================================================================

  describe('Integration Scenarios', () => {
    it('should handle extended outage with recovery', async () => {
      mockPipeline.setDown(true)

      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 0,
        maxRetries: 100,
        retryDelay: 100,
        // @ts-expect-error - new config option to be implemented
        onHealthChange: mockHealthCallback.onStatusChange,
      })

      // Phase 1: Continuous writes during outage
      for (let i = 0; i < 50; i++) {
        emitter.emit('thing.created', 'things', { $id: `thing-${i}` })
        await vi.advanceTimersByTimeAsync(10)
      }

      // Should be degraded
      expect(mockHealthCallback.getLatestStatus()).toBe('degraded')

      // Phase 2: Outage continues for "extended" period
      await vi.advanceTimersByTimeAsync(5000)

      // No events delivered
      expect(mockPipeline.events).toHaveLength(0)

      // Phase 3: Recovery
      mockPipeline.restore()
      await vi.advanceTimersByTimeAsync(2000)

      // All events should be delivered
      expect(mockPipeline.events).toHaveLength(50)
      expect(mockHealthCallback.getLatestStatus()).toBe('healthy')
    })

    it('should handle intermittent failures gracefully', async () => {
      // Simulate flaky Pipeline (50% failure rate)
      let attemptCount = 0
      mockPipeline.send.mockImplementation(async (batch: unknown[]) => {
        attemptCount++
        if (attemptCount % 2 === 0) {
          throw new Error('Intermittent failure')
        }
        mockPipeline.events.push(...batch)
      })

      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 0,
        batchSize: 1,
        maxRetries: 10,
        retryDelay: 20,
      })

      // Emit 10 events
      for (let i = 0; i < 10; i++) {
        emitter.emit('thing.created', 'things', { $id: `thing-${i}` })
        await vi.advanceTimersByTimeAsync(50)
      }

      await vi.advanceTimersByTimeAsync(1000)

      // All events should eventually succeed despite failures
      expect(mockPipeline.events).toHaveLength(10)
    })

    it('should handle rapid failover scenario', async () => {
      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 0,
        maxRetries: 5,
        retryDelay: 50,
      })

      // Normal operation
      emitter.emit('thing.created', 'things', { $id: 'thing-1' })
      await vi.advanceTimersByTimeAsync(50)

      // Pipeline fails
      mockPipeline.setDown(true)

      // More writes during failure
      emitter.emit('thing.created', 'things', { $id: 'thing-2' })
      emitter.emit('thing.created', 'things', { $id: 'thing-3' })
      await vi.advanceTimersByTimeAsync(100)

      // Quick failover to backup
      mockPipeline.restore()
      await vi.advanceTimersByTimeAsync(100)

      // Another failure
      mockPipeline.setDown(true)
      emitter.emit('thing.created', 'things', { $id: 'thing-4' })
      await vi.advanceTimersByTimeAsync(100)

      // Final recovery
      mockPipeline.restore()
      await vi.advanceTimersByTimeAsync(500)

      // All 4 events should be delivered
      expect(mockPipeline.events).toHaveLength(4)
    })
  })
})
