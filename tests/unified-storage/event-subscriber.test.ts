/**
 * EventSubscriber tests - Subscribe to Pipeline events for replication
 *
 * EventSubscriber enables DOs to subscribe to Pipeline events for replication:
 * - Subscribes to topics on the Pipeline event bus
 * - Receives events in order with batch delivery
 * - Checkpoints consumed offsets for durability
 * - Replays from checkpoint on reconnect
 * - Ensures exactly-once delivery via idempotency keys
 *
 * NOTE: These tests are designed to FAIL because the implementation does not exist yet.
 * This is the TDD RED phase.
 *
 * @see /objects/unified-storage/event-subscriber.ts (to be created in GREEN phase)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Import from non-existent module - this will cause tests to fail
import {
  EventSubscriber,
  type EventSubscriberConfig,
  type SubscriptionOptions,
  type ConsumedEvent,
  type CheckpointMode,
} from '../../objects/unified-storage/event-subscriber'

// ============================================================================
// MOCK PIPELINE SOURCE (Consumer-side Pipeline interface)
// ============================================================================

interface MockPipelineSourceOptions {
  /** Initial events available in the pipeline */
  events?: ConsumedEvent[]
  /** Simulate connection delay */
  connectDelayMs?: number
  /** Simulate error on connect */
  errorOnConnect?: Error | null
  /** Simulate error on consume */
  errorOnConsume?: Error | null
}

const createMockPipelineSource = (options: MockPipelineSourceOptions = {}) => {
  const events: ConsumedEvent[] = options.events?.slice() ?? []
  let connectDelay = options.connectDelayMs ?? 0
  let connectError = options.errorOnConnect ?? null
  let consumeError = options.errorOnConsume ?? null
  let currentOffset = 0
  let isConnected = false
  const subscribers = new Map<string, (event: ConsumedEvent) => void>()

  return {
    events,
    isConnected: () => isConnected,

    // Connect to topic
    connect: vi.fn(async (topic: string) => {
      if (connectDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, connectDelay))
      }
      if (connectError) {
        throw connectError
      }
      isConnected = true
      return { topic, offset: currentOffset }
    }),

    // Disconnect from topic
    disconnect: vi.fn(async () => {
      isConnected = false
    }),

    // Subscribe to events with callback
    subscribe: vi.fn((topic: string, callback: (event: ConsumedEvent) => void) => {
      subscribers.set(topic, callback)
    }),

    // Unsubscribe from events
    unsubscribe: vi.fn((topic: string) => {
      subscribers.delete(topic)
    }),

    // Consume events from offset
    consume: vi.fn(async (topic: string, fromOffset: number, limit: number) => {
      if (consumeError) {
        throw consumeError
      }
      const consumed = events.slice(fromOffset, fromOffset + limit)
      return {
        events: consumed,
        nextOffset: fromOffset + consumed.length,
        hasMore: fromOffset + consumed.length < events.length,
      }
    }),

    // Get current offset (latest)
    getLatestOffset: vi.fn(async (topic: string) => {
      return events.length
    }),

    // Simulate pushing new events (for testing real-time delivery)
    pushEvents: (newEvents: ConsumedEvent[]) => {
      events.push(...newEvents)
      // Notify subscribers
      for (const [topic, callback] of subscribers) {
        for (const event of newEvents) {
          if (event.topic === topic || topic === '*') {
            callback(event)
          }
        }
      }
    },

    // Configuration helpers
    setConnectDelay: (ms: number) => {
      connectDelay = ms
    },
    setConnectError: (err: Error | null) => {
      connectError = err
    },
    setConsumeError: (err: Error | null) => {
      consumeError = err
    },
    clear: () => {
      events.length = 0
      currentOffset = 0
      isConnected = false
      subscribers.clear()
    },
  }
}

type MockPipelineSource = ReturnType<typeof createMockPipelineSource>

// ============================================================================
// MOCK CHECKPOINT STORE
// ============================================================================

const createMockCheckpointStore = () => {
  const checkpoints = new Map<string, number>()

  return {
    get: vi.fn(async (key: string) => checkpoints.get(key) ?? null),
    set: vi.fn(async (key: string, offset: number) => {
      checkpoints.set(key, offset)
    }),
    delete: vi.fn(async (key: string) => {
      checkpoints.delete(key)
    }),
    getAll: vi.fn(async () => Object.fromEntries(checkpoints)),
    clear: () => {
      checkpoints.clear()
    },
    // Internal access for assertions
    _checkpoints: checkpoints,
  }
}

type MockCheckpointStore = ReturnType<typeof createMockCheckpointStore>

// ============================================================================
// HELPER: Create test events
// ============================================================================

const createTestEvent = (
  offset: number,
  topic: string = 'things',
  verb: string = 'thing.created'
): ConsumedEvent => ({
  offset,
  topic,
  verb,
  idempotencyKey: `${topic}-${offset}-${Date.now()}`,
  timestamp: new Date().toISOString(),
  payload: { $id: `entity-${offset}`, name: `Entity ${offset}` },
  _meta: { namespace: 'test-ns', source: 'test' },
})

const createTestEvents = (count: number, topic: string = 'things'): ConsumedEvent[] =>
  Array.from({ length: count }, (_, i) => createTestEvent(i, topic))

// ============================================================================
// TESTS
// ============================================================================

describe('EventSubscriber', () => {
  let mockSource: MockPipelineSource
  let mockCheckpointStore: MockCheckpointStore
  let subscriber: EventSubscriber

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T14:30:00.000Z'))
    mockSource = createMockPipelineSource()
    mockCheckpointStore = createMockCheckpointStore()
  })

  afterEach(async () => {
    if (subscriber) {
      await subscriber.close()
    }
    vi.useRealTimers()
  })

  // ============================================================================
  // SUBSCRIPTION LIFECYCLE TESTS
  // ============================================================================

  describe('subscription lifecycle', () => {
    it('should subscribe to topic and start consuming', async () => {
      subscriber = new EventSubscriber(mockSource as any, {
        namespace: 'test-ns',
        checkpointStore: mockCheckpointStore as any,
      })

      await subscriber.subscribe('things')

      expect(mockSource.connect).toHaveBeenCalledWith('things')
      expect(subscriber.isSubscribed).toBe(true)
    })

    it('should unsubscribe and stop consuming', async () => {
      subscriber = new EventSubscriber(mockSource as any, {
        namespace: 'test-ns',
        checkpointStore: mockCheckpointStore as any,
      })

      await subscriber.subscribe('things')
      await subscriber.unsubscribe('things')

      expect(mockSource.disconnect).toHaveBeenCalled()
      expect(subscriber.isSubscribed).toBe(false)
    })

    it('should track isSubscribed property correctly', async () => {
      subscriber = new EventSubscriber(mockSource as any, {
        namespace: 'test-ns',
        checkpointStore: mockCheckpointStore as any,
      })

      expect(subscriber.isSubscribed).toBe(false)

      await subscriber.subscribe('things')
      expect(subscriber.isSubscribed).toBe(true)

      await subscriber.unsubscribe('things')
      expect(subscriber.isSubscribed).toBe(false)
    })

    it('should support multiple subscriptions to different topics', async () => {
      subscriber = new EventSubscriber(mockSource as any, {
        namespace: 'test-ns',
        checkpointStore: mockCheckpointStore as any,
      })

      await subscriber.subscribe('things')
      await subscriber.subscribe('relationships')
      await subscriber.subscribe('events')

      expect(mockSource.connect).toHaveBeenCalledTimes(3)
      expect(subscriber.subscribedTopics).toContain('things')
      expect(subscriber.subscribedTopics).toContain('relationships')
      expect(subscriber.subscribedTopics).toContain('events')
    })

    it('should handle subscribe with options', async () => {
      subscriber = new EventSubscriber(mockSource as any, {
        namespace: 'test-ns',
        checkpointStore: mockCheckpointStore as any,
      })

      const options: SubscriptionOptions = {
        fromOffset: 100,
        batchSize: 50,
        autoCheckpoint: true,
      }

      await subscriber.subscribe('things', options)

      expect(subscriber.isSubscribed).toBe(true)
    })

    it('should not allow duplicate subscriptions to same topic', async () => {
      subscriber = new EventSubscriber(mockSource as any, {
        namespace: 'test-ns',
        checkpointStore: mockCheckpointStore as any,
      })

      await subscriber.subscribe('things')

      await expect(subscriber.subscribe('things')).rejects.toThrow(/already subscribed/i)
    })

    it('should clean up subscriptions on close', async () => {
      subscriber = new EventSubscriber(mockSource as any, {
        namespace: 'test-ns',
        checkpointStore: mockCheckpointStore as any,
      })

      await subscriber.subscribe('things')
      await subscriber.subscribe('events')

      await subscriber.close()

      expect(subscriber.isSubscribed).toBe(false)
      expect(subscriber.subscribedTopics).toHaveLength(0)
    })
  })

  // ============================================================================
  // EVENT CONSUMPTION TESTS
  // ============================================================================

  describe('event consumption', () => {
    it('should call onEvent callback when event received', async () => {
      const events = createTestEvents(3)
      mockSource = createMockPipelineSource({ events })

      const receivedEvents: ConsumedEvent[] = []
      const onEvent = vi.fn((event: ConsumedEvent) => {
        receivedEvents.push(event)
      })

      subscriber = new EventSubscriber(mockSource as any, {
        namespace: 'test-ns',
        checkpointStore: mockCheckpointStore as any,
        onEvent,
      })

      await subscriber.subscribe('things')

      // Trigger consumption
      await subscriber.poll()

      expect(onEvent).toHaveBeenCalled()
      expect(receivedEvents.length).toBeGreaterThan(0)
    })

    it('should deliver events in order', async () => {
      const events = createTestEvents(5)
      mockSource = createMockPipelineSource({ events })

      const receivedEvents: ConsumedEvent[] = []
      const onEvent = vi.fn((event: ConsumedEvent) => {
        receivedEvents.push(event)
      })

      subscriber = new EventSubscriber(mockSource as any, {
        namespace: 'test-ns',
        checkpointStore: mockCheckpointStore as any,
        onEvent,
      })

      await subscriber.subscribe('things')
      await subscriber.poll()

      // Events should be in offset order
      for (let i = 1; i < receivedEvents.length; i++) {
        expect(receivedEvents[i].offset).toBeGreaterThan(receivedEvents[i - 1].offset)
      }
    })

    it('should support batch delivery', async () => {
      const events = createTestEvents(10)
      mockSource = createMockPipelineSource({ events })

      const batches: ConsumedEvent[][] = []
      const onBatch = vi.fn((batch: ConsumedEvent[]) => {
        batches.push(batch)
      })

      subscriber = new EventSubscriber(mockSource as any, {
        namespace: 'test-ns',
        checkpointStore: mockCheckpointStore as any,
        onBatch,
        batchSize: 3,
      })

      await subscriber.subscribe('things')
      await subscriber.poll()

      // Should have received multiple batches
      expect(onBatch).toHaveBeenCalled()
      batches.forEach((batch) => {
        expect(batch.length).toBeLessThanOrEqual(3)
      })
    })

    it('should handle errors in onEvent callback gracefully', async () => {
      const events = createTestEvents(5)
      mockSource = createMockPipelineSource({ events })

      let errorCount = 0
      const onEvent = vi.fn((event: ConsumedEvent) => {
        if (event.offset === 2) {
          throw new Error('Callback error')
        }
      })

      const onError = vi.fn((err: Error, event: ConsumedEvent) => {
        errorCount++
      })

      subscriber = new EventSubscriber(mockSource as any, {
        namespace: 'test-ns',
        checkpointStore: mockCheckpointStore as any,
        onEvent,
        onError,
      })

      await subscriber.subscribe('things')
      await subscriber.poll()

      // Should continue processing after error
      expect(onEvent).toHaveBeenCalledTimes(5)
      expect(onError).toHaveBeenCalled()
    })

    it('should receive real-time events via push', async () => {
      const receivedEvents: ConsumedEvent[] = []
      const onEvent = vi.fn((event: ConsumedEvent) => {
        receivedEvents.push(event)
      })

      subscriber = new EventSubscriber(mockSource as any, {
        namespace: 'test-ns',
        checkpointStore: mockCheckpointStore as any,
        onEvent,
      })

      await subscriber.subscribe('things')

      // Push new events after subscription
      const newEvents = createTestEvents(3, 'things')
      mockSource.pushEvents(newEvents)

      await vi.advanceTimersByTimeAsync(100)

      expect(receivedEvents.length).toBe(3)
    })
  })

  // ============================================================================
  // CHECKPOINTING TESTS
  // ============================================================================

  describe('checkpointing', () => {
    it('should checkpoint offset after processing', async () => {
      const events = createTestEvents(5)
      mockSource = createMockPipelineSource({ events })

      subscriber = new EventSubscriber(mockSource as any, {
        namespace: 'test-ns',
        checkpointStore: mockCheckpointStore as any,
        onEvent: vi.fn(),
        checkpointMode: 'auto' as CheckpointMode,
      })

      await subscriber.subscribe('things')
      await subscriber.poll()

      // Should have checkpointed
      expect(mockCheckpointStore.set).toHaveBeenCalled()
    })

    it('should return last checkpoint via getCheckpoint()', async () => {
      // Pre-set checkpoint
      await mockCheckpointStore.set('things', 42)

      subscriber = new EventSubscriber(mockSource as any, {
        namespace: 'test-ns',
        checkpointStore: mockCheckpointStore as any,
      })

      const checkpoint = await subscriber.getCheckpoint('things')

      expect(checkpoint).toBe(42)
    })

    it('should persist checkpoint across restarts', async () => {
      const events = createTestEvents(10)
      mockSource = createMockPipelineSource({ events })

      // First subscriber processes events and checkpoints
      subscriber = new EventSubscriber(mockSource as any, {
        namespace: 'test-ns',
        checkpointStore: mockCheckpointStore as any,
        onEvent: vi.fn(),
        checkpointMode: 'auto' as CheckpointMode,
      })

      await subscriber.subscribe('things')
      await subscriber.poll()
      await subscriber.close()

      // Get the checkpointed offset
      const checkpointedOffset = mockCheckpointStore._checkpoints.get('things')
      expect(checkpointedOffset).toBeDefined()

      // Create new subscriber (simulating restart)
      const receivedEvents: ConsumedEvent[] = []
      const subscriber2 = new EventSubscriber(mockSource as any, {
        namespace: 'test-ns',
        checkpointStore: mockCheckpointStore as any,
        onEvent: (e) => receivedEvents.push(e),
      })

      await subscriber2.subscribe('things')
      await subscriber2.poll()

      // Should resume from checkpoint, not replay already-processed events
      expect(mockSource.consume).toHaveBeenCalledWith(
        'things',
        expect.any(Number),
        expect.any(Number)
      )
      await subscriber2.close()
    })

    it('should support manual checkpoint mode', async () => {
      const events = createTestEvents(5)
      mockSource = createMockPipelineSource({ events })

      subscriber = new EventSubscriber(mockSource as any, {
        namespace: 'test-ns',
        checkpointStore: mockCheckpointStore as any,
        onEvent: vi.fn(),
        checkpointMode: 'manual' as CheckpointMode,
      })

      await subscriber.subscribe('things')
      await subscriber.poll()

      // Should NOT auto-checkpoint
      expect(mockCheckpointStore.set).not.toHaveBeenCalled()

      // Manual checkpoint
      await subscriber.checkpoint('things', 3)

      expect(mockCheckpointStore.set).toHaveBeenCalledWith('things', 3)
    })

    it('should support auto-checkpoint after each batch', async () => {
      const events = createTestEvents(10)
      mockSource = createMockPipelineSource({ events })

      subscriber = new EventSubscriber(mockSource as any, {
        namespace: 'test-ns',
        checkpointStore: mockCheckpointStore as any,
        onEvent: vi.fn(),
        checkpointMode: 'auto' as CheckpointMode,
        batchSize: 3,
      })

      await subscriber.subscribe('things')
      await subscriber.poll()

      // Should checkpoint after each batch
      expect(mockCheckpointStore.set).toHaveBeenCalledTimes(4) // 10 events / 3 = 4 batches
    })

    it('should checkpoint on interval when configured', async () => {
      const events = createTestEvents(20)
      mockSource = createMockPipelineSource({ events })

      subscriber = new EventSubscriber(mockSource as any, {
        namespace: 'test-ns',
        checkpointStore: mockCheckpointStore as any,
        onEvent: vi.fn(),
        checkpointMode: 'interval' as CheckpointMode,
        checkpointInterval: 1000,
      })

      await subscriber.subscribe('things')

      // Process some events
      await subscriber.poll()

      // No checkpoint yet (interval not elapsed)
      const initialCheckpointCount = mockCheckpointStore.set.mock.calls.length

      // Advance time past interval
      await vi.advanceTimersByTimeAsync(1500)

      // Should have checkpointed
      expect(mockCheckpointStore.set.mock.calls.length).toBeGreaterThan(initialCheckpointCount)
    })
  })

  // ============================================================================
  // REPLAY TESTS
  // ============================================================================

  describe('replay', () => {
    it('should replay from specific offset via replayFrom()', async () => {
      const events = createTestEvents(10)
      mockSource = createMockPipelineSource({ events })

      const receivedEvents: ConsumedEvent[] = []
      subscriber = new EventSubscriber(mockSource as any, {
        namespace: 'test-ns',
        checkpointStore: mockCheckpointStore as any,
        onEvent: (e) => receivedEvents.push(e),
      })

      await subscriber.subscribe('things')

      // Replay from offset 5
      await subscriber.replayFrom('things', 5)

      // Should only receive events from offset 5 onwards
      expect(receivedEvents.every((e) => e.offset >= 5)).toBe(true)
      expect(mockSource.consume).toHaveBeenCalledWith('things', 5, expect.any(Number))
    })

    it('should use checkpoint on reconnect', async () => {
      // Pre-set checkpoint at offset 7
      await mockCheckpointStore.set('things', 7)

      const events = createTestEvents(10)
      mockSource = createMockPipelineSource({ events })

      subscriber = new EventSubscriber(mockSource as any, {
        namespace: 'test-ns',
        checkpointStore: mockCheckpointStore as any,
        onEvent: vi.fn(),
      })

      await subscriber.subscribe('things')
      await subscriber.poll()

      // Should resume from checkpointed offset
      expect(mockSource.consume).toHaveBeenCalledWith('things', 7, expect.any(Number))
    })

    it('should support full replay from beginning (offset=0)', async () => {
      // Pre-set checkpoint (simulate previous progress)
      await mockCheckpointStore.set('things', 5)

      const events = createTestEvents(10)
      mockSource = createMockPipelineSource({ events })

      const receivedEvents: ConsumedEvent[] = []
      subscriber = new EventSubscriber(mockSource as any, {
        namespace: 'test-ns',
        checkpointStore: mockCheckpointStore as any,
        onEvent: (e) => receivedEvents.push(e),
      })

      await subscriber.subscribe('things')

      // Request full replay from beginning
      await subscriber.replayFrom('things', 0)

      // Should receive all events from offset 0
      expect(mockSource.consume).toHaveBeenCalledWith('things', 0, expect.any(Number))
      expect(receivedEvents.some((e) => e.offset === 0)).toBe(true)
    })

    it('should skip duplicate events via idempotency during replay', async () => {
      const events = createTestEvents(5)
      // Set same idempotency key for duplicates
      events[2].idempotencyKey = 'duplicate-key'
      events[4].idempotencyKey = 'duplicate-key'
      mockSource = createMockPipelineSource({ events })

      const receivedEvents: ConsumedEvent[] = []
      subscriber = new EventSubscriber(mockSource as any, {
        namespace: 'test-ns',
        checkpointStore: mockCheckpointStore as any,
        onEvent: (e) => receivedEvents.push(e),
        enableIdempotency: true,
      })

      await subscriber.subscribe('things')
      await subscriber.replayFrom('things', 0)

      // Should deduplicate based on idempotency key
      const idempotencyKeys = receivedEvents.map((e) => e.idempotencyKey)
      const uniqueKeys = new Set(idempotencyKeys)
      expect(uniqueKeys.size).toBe(idempotencyKeys.length)
    })

    it('should support catch-up replay after disconnect', async () => {
      const events = createTestEvents(10)
      mockSource = createMockPipelineSource({ events })

      const receivedEvents: ConsumedEvent[] = []
      subscriber = new EventSubscriber(mockSource as any, {
        namespace: 'test-ns',
        checkpointStore: mockCheckpointStore as any,
        onEvent: (e) => receivedEvents.push(e),
        checkpointMode: 'auto' as CheckpointMode,
      })

      await subscriber.subscribe('things')
      await subscriber.poll() // Process initial events

      const processedCount = receivedEvents.length

      // Simulate disconnect
      await subscriber.unsubscribe('things')

      // Add more events while disconnected
      const newEvents = createTestEvents(5).map((e, i) => ({
        ...e,
        offset: 10 + i,
      }))
      mockSource.events.push(...newEvents)

      // Reconnect - should catch up from checkpoint
      await subscriber.subscribe('things')
      await subscriber.poll()

      expect(receivedEvents.length).toBeGreaterThan(processedCount)
    })
  })

  // ============================================================================
  // EXACTLY-ONCE DELIVERY TESTS
  // ============================================================================

  describe('exactly-once delivery', () => {
    it('should track idempotency keys', async () => {
      const events = createTestEvents(5)
      mockSource = createMockPipelineSource({ events })

      subscriber = new EventSubscriber(mockSource as any, {
        namespace: 'test-ns',
        checkpointStore: mockCheckpointStore as any,
        onEvent: vi.fn(),
        enableIdempotency: true,
      })

      await subscriber.subscribe('things')
      await subscriber.poll()

      // Should have recorded idempotency keys
      expect(subscriber.seenIdempotencyKeys.size).toBeGreaterThan(0)
    })

    it('should ignore duplicate events with same idempotency key', async () => {
      const duplicateKey = 'unique-idempotency-key-123'
      const events: ConsumedEvent[] = [
        { ...createTestEvent(0), idempotencyKey: duplicateKey },
        { ...createTestEvent(1), idempotencyKey: 'other-key-1' },
        { ...createTestEvent(2), idempotencyKey: duplicateKey }, // Duplicate
        { ...createTestEvent(3), idempotencyKey: 'other-key-2' },
      ]
      mockSource = createMockPipelineSource({ events })

      const processedEvents: ConsumedEvent[] = []
      subscriber = new EventSubscriber(mockSource as any, {
        namespace: 'test-ns',
        checkpointStore: mockCheckpointStore as any,
        onEvent: (e) => processedEvents.push(e),
        enableIdempotency: true,
      })

      await subscriber.subscribe('things')
      await subscriber.poll()

      // Should have processed only 3 unique events
      expect(processedEvents.length).toBe(3)

      // Duplicate key should only appear once
      const keyCounts = processedEvents.filter((e) => e.idempotencyKey === duplicateKey)
      expect(keyCounts.length).toBe(1)
    })

    it('should support configurable idempotency window', async () => {
      subscriber = new EventSubscriber(mockSource as any, {
        namespace: 'test-ns',
        checkpointStore: mockCheckpointStore as any,
        onEvent: vi.fn(),
        enableIdempotency: true,
        idempotencyWindowMs: 5000, // 5 second window
      })

      expect(subscriber.config.idempotencyWindowMs).toBe(5000)
    })

    it('should clean up old idempotency keys outside window', async () => {
      const events = createTestEvents(10)
      mockSource = createMockPipelineSource({ events })

      subscriber = new EventSubscriber(mockSource as any, {
        namespace: 'test-ns',
        checkpointStore: mockCheckpointStore as any,
        onEvent: vi.fn(),
        enableIdempotency: true,
        idempotencyWindowMs: 1000, // 1 second window
      })

      await subscriber.subscribe('things')
      await subscriber.poll()

      const initialKeyCount = subscriber.seenIdempotencyKeys.size
      expect(initialKeyCount).toBeGreaterThan(0)

      // Advance time past idempotency window
      await vi.advanceTimersByTimeAsync(2000)

      // Trigger cleanup
      subscriber.cleanupIdempotencyKeys()

      // Old keys should be removed
      expect(subscriber.seenIdempotencyKeys.size).toBeLessThan(initialKeyCount)
    })

    it('should not process same event twice even with replay', async () => {
      const events = createTestEvents(5)
      mockSource = createMockPipelineSource({ events })

      const processedEvents: ConsumedEvent[] = []
      subscriber = new EventSubscriber(mockSource as any, {
        namespace: 'test-ns',
        checkpointStore: mockCheckpointStore as any,
        onEvent: (e) => processedEvents.push(e),
        enableIdempotency: true,
      })

      await subscriber.subscribe('things')
      await subscriber.poll()

      const firstProcessCount = processedEvents.length

      // Replay from beginning
      await subscriber.replayFrom('things', 0)

      // Should not re-process events already seen (idempotency)
      // Events should only be processed once
      const uniqueOffsets = new Set(processedEvents.map((e) => e.offset))
      expect(uniqueOffsets.size).toBe(processedEvents.length)
    })

    it('should expose idempotency stats', async () => {
      const events = createTestEvents(5)
      // Create some duplicates
      events.push({ ...events[0], offset: 5 }) // Duplicate of first event
      events.push({ ...events[1], offset: 6 }) // Duplicate of second event
      mockSource = createMockPipelineSource({ events })

      subscriber = new EventSubscriber(mockSource as any, {
        namespace: 'test-ns',
        checkpointStore: mockCheckpointStore as any,
        onEvent: vi.fn(),
        enableIdempotency: true,
      })

      await subscriber.subscribe('things')
      await subscriber.poll()

      const stats = subscriber.idempotencyStats

      expect(stats.trackedKeys).toBeGreaterThan(0)
      expect(stats.duplicatesSkipped).toBe(2)
    })
  })

  // ============================================================================
  // CONSTRUCTOR AND CONFIG TESTS
  // ============================================================================

  describe('constructor and configuration', () => {
    it('should create with pipeline source and basic config', () => {
      subscriber = new EventSubscriber(mockSource as any, {
        namespace: 'test-ns',
        checkpointStore: mockCheckpointStore as any,
      })

      expect(subscriber).toBeInstanceOf(EventSubscriber)
    })

    it('should use default config values', () => {
      subscriber = new EventSubscriber(mockSource as any, {
        namespace: 'test-ns',
        checkpointStore: mockCheckpointStore as any,
      })

      expect(subscriber.config.batchSize).toBe(100)
      expect(subscriber.config.pollInterval).toBe(1000)
      expect(subscriber.config.checkpointMode).toBe('auto')
    })

    it('should accept custom config', () => {
      const config: EventSubscriberConfig = {
        namespace: 'custom-ns',
        checkpointStore: mockCheckpointStore as any,
        batchSize: 50,
        pollInterval: 500,
        checkpointMode: 'manual' as CheckpointMode,
        enableIdempotency: true,
        idempotencyWindowMs: 10000,
      }

      subscriber = new EventSubscriber(mockSource as any, config)

      expect(subscriber.config.namespace).toBe('custom-ns')
      expect(subscriber.config.batchSize).toBe(50)
      expect(subscriber.config.pollInterval).toBe(500)
      expect(subscriber.config.checkpointMode).toBe('manual')
    })

    it('should expose config as readonly', () => {
      subscriber = new EventSubscriber(mockSource as any, {
        namespace: 'test-ns',
        checkpointStore: mockCheckpointStore as any,
      })

      // Config should be accessible
      expect(subscriber.config).toBeDefined()
      expect(subscriber.config.namespace).toBe('test-ns')
    })
  })

  // ============================================================================
  // LIFECYCLE TESTS
  // ============================================================================

  describe('lifecycle', () => {
    it('should flush and checkpoint on close', async () => {
      const events = createTestEvents(5)
      mockSource = createMockPipelineSource({ events })

      subscriber = new EventSubscriber(mockSource as any, {
        namespace: 'test-ns',
        checkpointStore: mockCheckpointStore as any,
        onEvent: vi.fn(),
        checkpointMode: 'manual' as CheckpointMode,
      })

      await subscriber.subscribe('things')
      await subscriber.poll()

      await subscriber.close()

      // Should checkpoint on close even in manual mode
      expect(mockCheckpointStore.set).toHaveBeenCalled()
    })

    it('should stop polling after close', async () => {
      subscriber = new EventSubscriber(mockSource as any, {
        namespace: 'test-ns',
        checkpointStore: mockCheckpointStore as any,
        onEvent: vi.fn(),
        pollInterval: 100,
      })

      await subscriber.subscribe('things')

      const pollCountBefore = mockSource.consume.mock.calls.length

      await subscriber.close()

      // Advance time - should not trigger more polls
      await vi.advanceTimersByTimeAsync(500)

      expect(mockSource.consume.mock.calls.length).toBe(pollCountBefore)
    })

    it('should expose closed state', async () => {
      subscriber = new EventSubscriber(mockSource as any, {
        namespace: 'test-ns',
        checkpointStore: mockCheckpointStore as any,
      })

      expect(subscriber.closed).toBe(false)

      await subscriber.close()

      expect(subscriber.closed).toBe(true)
    })

    it('should reject operations after close', async () => {
      subscriber = new EventSubscriber(mockSource as any, {
        namespace: 'test-ns',
        checkpointStore: mockCheckpointStore as any,
      })

      await subscriber.close()

      await expect(subscriber.subscribe('things')).rejects.toThrow(/closed/i)
    })

    it('should expose processing stats', async () => {
      const events = createTestEvents(10)
      mockSource = createMockPipelineSource({ events })

      subscriber = new EventSubscriber(mockSource as any, {
        namespace: 'test-ns',
        checkpointStore: mockCheckpointStore as any,
        onEvent: vi.fn(),
      })

      await subscriber.subscribe('things')
      await subscriber.poll()

      const stats = subscriber.stats

      expect(stats.eventsProcessed).toBeGreaterThan(0)
      expect(stats.batchesProcessed).toBeGreaterThan(0)
      expect(stats.lastProcessedOffset).toBeDefined()
    })
  })

  // ============================================================================
  // ERROR HANDLING TESTS
  // ============================================================================

  describe('error handling', () => {
    it('should handle connection errors', async () => {
      mockSource.setConnectError(new Error('Connection refused'))

      subscriber = new EventSubscriber(mockSource as any, {
        namespace: 'test-ns',
        checkpointStore: mockCheckpointStore as any,
      })

      await expect(subscriber.subscribe('things')).rejects.toThrow('Connection refused')
    })

    it('should handle consume errors with retry', async () => {
      let attemptCount = 0
      mockSource.consume.mockImplementation(async () => {
        attemptCount++
        if (attemptCount < 3) {
          throw new Error('Consume failed')
        }
        return { events: [], nextOffset: 0, hasMore: false }
      })

      subscriber = new EventSubscriber(mockSource as any, {
        namespace: 'test-ns',
        checkpointStore: mockCheckpointStore as any,
        maxRetries: 3,
        retryDelay: 100,
      })

      await subscriber.subscribe('things')
      await subscriber.poll()

      // Should have retried and eventually succeeded
      expect(attemptCount).toBe(3)
    })

    it('should emit error events', async () => {
      mockSource.setConsumeError(new Error('Consume failed'))

      const errors: Error[] = []
      subscriber = new EventSubscriber(mockSource as any, {
        namespace: 'test-ns',
        checkpointStore: mockCheckpointStore as any,
        onError: (err) => errors.push(err),
        maxRetries: 1,
      })

      await subscriber.subscribe('things')

      try {
        await subscriber.poll()
      } catch {
        // Expected
      }

      expect(errors.length).toBeGreaterThan(0)
    })
  })

  // ============================================================================
  // INTEGRATION TESTS
  // ============================================================================

  describe('integration scenarios', () => {
    it('should work with unified storage replication pattern', async () => {
      const events: ConsumedEvent[] = [
        {
          offset: 0,
          topic: 'things',
          verb: 'thing.created',
          idempotencyKey: 'things-0-create',
          timestamp: '2026-01-09T14:30:00.000Z',
          payload: { $id: 'customer-123', $type: 'Customer', name: 'Acme Corp' },
          _meta: { namespace: 'primary-do', source: 'unified-store' },
        },
        {
          offset: 1,
          topic: 'things',
          verb: 'thing.updated',
          idempotencyKey: 'things-1-update',
          timestamp: '2026-01-09T14:31:00.000Z',
          payload: { $id: 'customer-123', plan: 'enterprise' },
          _meta: { namespace: 'primary-do', source: 'unified-store', isDelta: true },
        },
        {
          offset: 2,
          topic: 'relationships',
          verb: 'relationship.created',
          idempotencyKey: 'rels-0-create',
          timestamp: '2026-01-09T14:32:00.000Z',
          payload: { from: 'customer-123', to: 'order-456', type: 'placed' },
          _meta: { namespace: 'primary-do', source: 'unified-store' },
        },
      ]
      mockSource = createMockPipelineSource({ events })

      const replicated: ConsumedEvent[] = []

      subscriber = new EventSubscriber(mockSource as any, {
        namespace: 'replica-do',
        checkpointStore: mockCheckpointStore as any,
        onEvent: (e) => replicated.push(e),
        enableIdempotency: true,
        checkpointMode: 'auto' as CheckpointMode,
      })

      await subscriber.subscribe('things')
      await subscriber.subscribe('relationships')
      await subscriber.poll()

      expect(replicated.length).toBe(3)
      expect(replicated.map((e) => e.verb)).toEqual([
        'thing.created',
        'thing.updated',
        'relationship.created',
      ])
    })

    it('should handle high-throughput event streams', async () => {
      const events = createTestEvents(1000)
      mockSource = createMockPipelineSource({ events })

      let processedCount = 0
      subscriber = new EventSubscriber(mockSource as any, {
        namespace: 'test-ns',
        checkpointStore: mockCheckpointStore as any,
        onEvent: () => {
          processedCount++
        },
        batchSize: 100,
      })

      await subscriber.subscribe('things')

      // Process all events
      while (processedCount < 1000) {
        await subscriber.poll()
        await vi.advanceTimersByTimeAsync(100)
      }

      expect(processedCount).toBe(1000)
    })

    it('should support multi-shard subscription', async () => {
      const events = [
        ...createTestEvents(5).map((e) => ({ ...e, topic: 'things:shard-0' })),
        ...createTestEvents(5).map((e, i) => ({
          ...e,
          offset: 5 + i,
          topic: 'things:shard-1',
        })),
        ...createTestEvents(5).map((e, i) => ({
          ...e,
          offset: 10 + i,
          topic: 'things:shard-2',
        })),
      ]
      mockSource = createMockPipelineSource({ events })

      const receivedEvents: ConsumedEvent[] = []
      subscriber = new EventSubscriber(mockSource as any, {
        namespace: 'test-ns',
        checkpointStore: mockCheckpointStore as any,
        onEvent: (e) => receivedEvents.push(e),
      })

      await subscriber.subscribe('things:shard-0')
      await subscriber.subscribe('things:shard-1')
      await subscriber.subscribe('things:shard-2')

      await subscriber.poll()

      // Should receive events from all shards
      const topics = new Set(receivedEvents.map((e) => e.topic))
      expect(topics.size).toBe(3)
    })
  })
})
