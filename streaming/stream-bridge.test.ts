/**
 * StreamBridge tests - Cloudflare Pipelines integration
 *
 * Tests for StreamBridge - an event batching layer that sends to Cloudflare Pipelines:
 * - Event buffering until batch size (1000 events or 1MB)
 * - Flush on interval (60s default)
 * - Parquet format output
 * - Partition key (_partition_hour) generation
 * - Transform functions
 * - Error handling
 *
 * NOTE: These tests are designed to FAIL because the implementation does not exist yet.
 * Import from './stream-bridge' which does not exist.
 *
 * @see /streaming/README.md for the StreamBridge API design
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Import from non-existent module - this will cause tests to fail
import { StreamBridge, type StreamBridgeConfig, type StreamEvent } from './stream-bridge'

// ============================================================================
// MOCK PIPELINE
// ============================================================================

interface MockPipelineOptions {
  sendDelayMs?: number
  errorOnSend?: Error | null
}

const createMockPipeline = (options: MockPipelineOptions = {}) => {
  const events: unknown[] = []
  let delay = options.sendDelayMs ?? 0
  let error = options.errorOnSend ?? null

  const send = vi.fn(async (batch: unknown[]) => {
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay))
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
    clear: () => {
      events.length = 0
      send.mockClear()
    },
  }
}

type MockPipeline = ReturnType<typeof createMockPipeline>

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Calculate approximate size of JSON-serialized data in bytes
 */
function estimateSize(data: unknown): number {
  return JSON.stringify(data).length
}

/**
 * Create a large event with specified approximate size in bytes
 */
function createLargeEvent(sizeInBytes: number): { id: string; payload: string } {
  const baseSize = estimateSize({ id: 'test', payload: '' })
  const payloadSize = Math.max(0, sizeInBytes - baseSize)
  return {
    id: 'test',
    payload: 'x'.repeat(payloadSize),
  }
}

// ============================================================================
// CONSTRUCTOR TESTS
// ============================================================================

describe('StreamBridge', () => {
  let mockPipeline: MockPipeline
  let bridge: StreamBridge

  beforeEach(() => {
    vi.useFakeTimers()
    mockPipeline = createMockPipeline()
  })

  afterEach(async () => {
    if (bridge) {
      await bridge.close()
    }
    vi.useRealTimers()
  })

  describe('constructor', () => {
    it('should create with pipeline binding only', () => {
      bridge = new StreamBridge(mockPipeline as any)
      expect(bridge).toBeInstanceOf(StreamBridge)
    })

    it('should create with custom config', () => {
      const config: StreamBridgeConfig = {
        sink: 'parquet',
        batchSize: 500,
        batchBytes: 512 * 1024, // 512KB
        flushInterval: 30_000,
      }
      bridge = new StreamBridge(mockPipeline as any, config)

      expect(bridge.config.sink).toBe('parquet')
      expect(bridge.config.batchSize).toBe(500)
      expect(bridge.config.batchBytes).toBe(512 * 1024)
      expect(bridge.config.flushInterval).toBe(30_000)
    })

    it('should use default config values', () => {
      bridge = new StreamBridge(mockPipeline as any)

      // Defaults from README: batchSize: 1000, flushInterval: 60_000
      expect(bridge.config.batchSize).toBe(1000)
      expect(bridge.config.flushInterval).toBe(60_000)
      expect(bridge.config.batchBytes).toBe(1024 * 1024) // 1MB default
      expect(bridge.config.sink).toBe('iceberg')
    })

    it('should accept transform function in config', () => {
      const transform = vi.fn((event: StreamEvent) => ({
        ...event,
        _partition_hour: '2026-01-09-10',
      }))

      bridge = new StreamBridge(mockPipeline as any, { transform })
      expect(bridge.config.transform).toBe(transform)
    })
  })

  // ============================================================================
  // EMIT TESTS
  // ============================================================================

  describe('emit', () => {
    beforeEach(() => {
      bridge = new StreamBridge(mockPipeline as any, {
        batchSize: 100,
        batchBytes: 1024 * 1024,
        flushInterval: 60_000,
      })
    })

    it('should add events to buffer', () => {
      bridge.emit('insert', 'users', { id: 1, name: 'Alice' })
      bridge.emit('insert', 'users', { id: 2, name: 'Bob' })

      expect(bridge.bufferSize).toBe(2)
    })

    it('should create event with correct structure', async () => {
      bridge.emit('insert', 'orders', { orderId: 123, total: 99.99 })
      await bridge.flush()

      expect(mockPipeline.send).toHaveBeenCalledTimes(1)
      const sentEvents = mockPipeline.send.mock.calls[0][0] as StreamEvent[]
      expect(sentEvents).toHaveLength(1)

      const event = sentEvents[0]
      expect(event.operation).toBe('insert')
      expect(event.table).toBe('orders')
      expect(event.data).toEqual({ orderId: 123, total: 99.99 })
      expect(typeof event.timestamp).toBe('number')
    })

    it('should support insert operation', () => {
      bridge.emit('insert', 'users', { id: 1 })
      expect(bridge.bufferSize).toBe(1)
    })

    it('should support update operation', () => {
      bridge.emit('update', 'users', { id: 1, name: 'Updated' })
      expect(bridge.bufferSize).toBe(1)
    })

    it('should support delete operation', () => {
      bridge.emit('delete', 'users', { id: 1 })
      expect(bridge.bufferSize).toBe(1)
    })

    it('should track buffer bytes', () => {
      const data = { id: 1, name: 'Alice', email: 'alice@example.com.ai' }
      bridge.emit('insert', 'users', data)

      // bufferBytes should track the approximate size
      expect(bridge.bufferBytes).toBeGreaterThan(0)
    })

    it('should not emit after close', async () => {
      await bridge.close()
      bridge.emit('insert', 'users', { id: 1 })

      expect(bridge.bufferSize).toBe(0)
    })
  })

  // ============================================================================
  // BATCH SIZE TRIGGER TESTS
  // ============================================================================

  describe('batch size triggering', () => {
    it('should auto-flush when batch count reaches limit', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        batchSize: 3,
        batchBytes: 10 * 1024 * 1024, // High byte limit
        flushInterval: 60_000,
      })

      bridge.emit('insert', 'users', { id: 1 })
      bridge.emit('insert', 'users', { id: 2 })
      expect(mockPipeline.send).not.toHaveBeenCalled()

      bridge.emit('insert', 'users', { id: 3 })

      // Wait for async flush
      await vi.advanceTimersByTimeAsync(10)

      expect(mockPipeline.send).toHaveBeenCalledTimes(1)
      expect(mockPipeline.events).toHaveLength(3)
      expect(bridge.bufferSize).toBe(0)
    })

    it('should use default batch size of 1000', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        batchBytes: 100 * 1024 * 1024, // Very high byte limit
        flushInterval: 60_000,
      })

      // Emit 999 events - should not flush
      for (let i = 0; i < 999; i++) {
        bridge.emit('insert', 'events', { id: i })
      }
      expect(mockPipeline.send).not.toHaveBeenCalled()

      // Emit 1000th event - should trigger flush
      bridge.emit('insert', 'events', { id: 999 })
      await vi.advanceTimersByTimeAsync(10)

      expect(mockPipeline.send).toHaveBeenCalledTimes(1)
    })

    it('should auto-flush when batch bytes reaches 1MB limit', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        batchSize: 100_000, // High count limit
        batchBytes: 1024, // 1KB for testing
        flushInterval: 60_000,
      })

      // Create events that together exceed 1KB
      const largeData = { payload: 'x'.repeat(400) }
      bridge.emit('insert', 'data', largeData)
      bridge.emit('insert', 'data', largeData)
      expect(mockPipeline.send).not.toHaveBeenCalled()

      bridge.emit('insert', 'data', largeData) // This should push over 1KB
      await vi.advanceTimersByTimeAsync(10)

      expect(mockPipeline.send).toHaveBeenCalledTimes(1)
    })

    it('should flush on whichever limit is reached first (count)', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        batchSize: 2, // Low count
        batchBytes: 10 * 1024 * 1024, // High bytes
        flushInterval: 60_000,
      })

      bridge.emit('insert', 'small', { x: 1 })
      bridge.emit('insert', 'small', { x: 2 })
      await vi.advanceTimersByTimeAsync(10)

      expect(mockPipeline.send).toHaveBeenCalledTimes(1)
    })

    it('should flush on whichever limit is reached first (bytes)', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        batchSize: 1000, // High count
        batchBytes: 100, // Low bytes (100 bytes)
        flushInterval: 60_000,
      })

      // Single large event that exceeds byte limit
      bridge.emit('insert', 'large', { payload: 'x'.repeat(200) })
      await vi.advanceTimersByTimeAsync(10)

      expect(mockPipeline.send).toHaveBeenCalledTimes(1)
    })

    it('should reset counters after flush', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        batchSize: 2,
        flushInterval: 60_000,
      })

      bridge.emit('insert', 'users', { id: 1 })
      bridge.emit('insert', 'users', { id: 2 })
      await vi.advanceTimersByTimeAsync(10)

      expect(bridge.bufferSize).toBe(0)
      expect(bridge.bufferBytes).toBe(0)

      // Should be able to fill buffer again
      bridge.emit('insert', 'users', { id: 3 })
      bridge.emit('insert', 'users', { id: 4 })
      await vi.advanceTimersByTimeAsync(10)

      expect(mockPipeline.send).toHaveBeenCalledTimes(2)
    })
  })

  // ============================================================================
  // TIME INTERVAL TRIGGER TESTS
  // ============================================================================

  describe('flush on interval', () => {
    it('should flush at configured interval (default 60s)', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        batchSize: 1000,
        flushInterval: 60_000,
      })

      bridge.emit('insert', 'events', { id: 1 })
      expect(mockPipeline.send).not.toHaveBeenCalled()

      // Advance time to just before interval
      await vi.advanceTimersByTimeAsync(59_000)
      expect(mockPipeline.send).not.toHaveBeenCalled()

      // Advance past interval
      await vi.advanceTimersByTimeAsync(2_000)
      expect(mockPipeline.send).toHaveBeenCalledTimes(1)
    })

    it('should use custom flush interval', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        batchSize: 1000,
        flushInterval: 5_000, // 5 seconds
      })

      bridge.emit('insert', 'events', { id: 1 })

      await vi.advanceTimersByTimeAsync(4_000)
      expect(mockPipeline.send).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(2_000)
      expect(mockPipeline.send).toHaveBeenCalledTimes(1)
    })

    it('should not flush if buffer is empty at interval', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        batchSize: 1000,
        flushInterval: 5_000,
      })

      // Don't emit anything
      await vi.advanceTimersByTimeAsync(10_000)
      expect(mockPipeline.send).not.toHaveBeenCalled()
    })

    it('should continue flushing at intervals', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        batchSize: 1000,
        flushInterval: 1_000,
      })

      bridge.emit('insert', 'events', { id: 1 })
      await vi.advanceTimersByTimeAsync(1_100)
      expect(mockPipeline.send).toHaveBeenCalledTimes(1)

      bridge.emit('insert', 'events', { id: 2 })
      await vi.advanceTimersByTimeAsync(1_100)
      expect(mockPipeline.send).toHaveBeenCalledTimes(2)

      bridge.emit('insert', 'events', { id: 3 })
      await vi.advanceTimersByTimeAsync(1_100)
      expect(mockPipeline.send).toHaveBeenCalledTimes(3)
    })

    it('should stop interval timer on close', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        batchSize: 1000,
        flushInterval: 1_000,
      })

      bridge.emit('insert', 'events', { id: 1 })
      await bridge.close()

      // Flush should have happened on close
      expect(mockPipeline.send).toHaveBeenCalledTimes(1)

      // New events after close should not work
      bridge.emit('insert', 'events', { id: 2 })
      await vi.advanceTimersByTimeAsync(2_000)

      // Should still be 1 (no new flushes)
      expect(mockPipeline.send).toHaveBeenCalledTimes(1)
    })

    it('should reset interval timer after batch size flush', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        batchSize: 2,
        flushInterval: 10_000,
      })

      // Trigger batch size flush
      bridge.emit('insert', 'events', { id: 1 })
      bridge.emit('insert', 'events', { id: 2 })
      await vi.advanceTimersByTimeAsync(10)
      expect(mockPipeline.send).toHaveBeenCalledTimes(1)

      // Add new event
      bridge.emit('insert', 'events', { id: 3 })

      // Wait less than interval - should not flush
      await vi.advanceTimersByTimeAsync(5_000)
      expect(mockPipeline.send).toHaveBeenCalledTimes(1)

      // Wait for full interval from last flush
      await vi.advanceTimersByTimeAsync(6_000)
      expect(mockPipeline.send).toHaveBeenCalledTimes(2)
    })
  })

  // ============================================================================
  // PARQUET FORMAT OUTPUT TESTS
  // ============================================================================

  describe('Parquet format output', () => {
    it('should format events for parquet sink', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        sink: 'parquet',
        batchSize: 100,
      })

      bridge.emit('insert', 'orders', { id: 1, amount: 100 })
      await bridge.flush()

      const events = mockPipeline.events as StreamEvent[]
      expect(events).toHaveLength(1)

      // Parquet format should have flat structure with metadata
      expect(events[0]).toHaveProperty('operation', 'insert')
      expect(events[0]).toHaveProperty('table', 'orders')
      expect(events[0]).toHaveProperty('timestamp')
      expect(events[0]).toHaveProperty('data')
    })

    it('should include parquet metadata fields', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        sink: 'parquet',
        batchSize: 100,
      })

      bridge.emit('insert', 'events', { eventType: 'click' })
      await bridge.flush()

      const events = mockPipeline.events as StreamEvent[]
      const event = events[0]

      // Parquet events should have partition-friendly structure
      expect(event).toHaveProperty('_partition_hour')
      expect(typeof event._partition_hour).toBe('string')
      // Format: YYYY-MM-DD-HH
      expect(event._partition_hour).toMatch(/^\d{4}-\d{2}-\d{2}-\d{2}$/)
    })

    it('should flatten nested data for parquet', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        sink: 'parquet',
        batchSize: 100,
      })

      bridge.emit('insert', 'users', {
        id: 1,
        profile: { name: 'Alice', age: 30 },
      })
      await bridge.flush()

      const events = mockPipeline.events as StreamEvent[]

      // For parquet, nested data should be accessible
      // Implementation may flatten or serialize
      expect(events[0].data).toBeDefined()
    })

    it('should use iceberg sink by default', async () => {
      bridge = new StreamBridge(mockPipeline as any)

      expect(bridge.config.sink).toBe('iceberg')
    })

    it('should support json sink', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        sink: 'json',
        batchSize: 100,
      })

      bridge.emit('insert', 'logs', { message: 'test' })
      await bridge.flush()

      expect(mockPipeline.events).toHaveLength(1)
    })
  })

  // ============================================================================
  // PARTITION KEY (_partition_hour) TESTS
  // ============================================================================

  describe('partition key generation (_partition_hour)', () => {
    it('should add _partition_hour to all events', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        batchSize: 100,
      })

      bridge.emit('insert', 'events', { id: 1 })
      await bridge.flush()

      const events = mockPipeline.events as StreamEvent[]
      expect(events[0]).toHaveProperty('_partition_hour')
    })

    it('should format _partition_hour as YYYY-MM-DD-HH', async () => {
      // Set a known time
      vi.setSystemTime(new Date('2026-01-09T14:30:00Z'))

      bridge = new StreamBridge(mockPipeline as any, {
        batchSize: 100,
      })

      bridge.emit('insert', 'events', { id: 1 })
      await bridge.flush()

      const events = mockPipeline.events as StreamEvent[]
      expect(events[0]._partition_hour).toBe('2026-01-09-14')
    })

    it('should derive partition hour from event timestamp', async () => {
      vi.setSystemTime(new Date('2026-01-09T23:59:59Z'))

      bridge = new StreamBridge(mockPipeline as any, {
        batchSize: 100,
      })

      bridge.emit('insert', 'events', { id: 1 })
      await bridge.flush()

      const events = mockPipeline.events as StreamEvent[]
      expect(events[0]._partition_hour).toBe('2026-01-09-23')
    })

    it('should handle different timezones correctly (UTC)', async () => {
      // Ensure partition hour is always UTC
      vi.setSystemTime(new Date('2026-01-09T00:30:00Z'))

      bridge = new StreamBridge(mockPipeline as any, {
        batchSize: 100,
      })

      bridge.emit('insert', 'events', { id: 1 })
      await bridge.flush()

      const events = mockPipeline.events as StreamEvent[]
      // Should be hour 00, not affected by local timezone
      expect(events[0]._partition_hour).toBe('2026-01-09-00')
    })

    it('should batch events with same partition hour together', async () => {
      vi.setSystemTime(new Date('2026-01-09T10:00:00Z'))

      bridge = new StreamBridge(mockPipeline as any, {
        batchSize: 100,
      })

      bridge.emit('insert', 'events', { id: 1 })
      bridge.emit('insert', 'events', { id: 2 })
      bridge.emit('insert', 'events', { id: 3 })
      await bridge.flush()

      const events = mockPipeline.events as StreamEvent[]
      expect(events).toHaveLength(3)

      // All should have same partition hour
      const partitionHours = events.map((e) => e._partition_hour)
      expect(new Set(partitionHours).size).toBe(1)
      expect(partitionHours[0]).toBe('2026-01-09-10')
    })

    it('should allow custom partition key via transform', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        batchSize: 100,
        transform: (event: StreamEvent) => ({
          ...event,
          _partition_hour: 'custom-partition',
          _custom_key: 'my-value',
        }),
      })

      bridge.emit('insert', 'events', { id: 1 })
      await bridge.flush()

      const events = mockPipeline.events as any[]
      expect(events[0]._partition_hour).toBe('custom-partition')
      expect(events[0]._custom_key).toBe('my-value')
    })
  })

  // ============================================================================
  // TRANSFORM FUNCTION TESTS
  // ============================================================================

  describe('transform functions', () => {
    it('should apply transform to all events', async () => {
      const transform = vi.fn((event: StreamEvent) => ({
        ...event,
        transformed: true,
      }))

      bridge = new StreamBridge(mockPipeline as any, {
        batchSize: 100,
        transform,
      })

      bridge.emit('insert', 'users', { id: 1 })
      bridge.emit('insert', 'users', { id: 2 })
      await bridge.flush()

      expect(transform).toHaveBeenCalledTimes(2)

      const events = mockPipeline.events as any[]
      expect(events[0].transformed).toBe(true)
      expect(events[1].transformed).toBe(true)
    })

    it('should filter events when transform returns null', async () => {
      const transform = (event: StreamEvent) => {
        // Filter out delete operations
        if (event.operation === 'delete') {
          return null
        }
        return event
      }

      bridge = new StreamBridge(mockPipeline as any, {
        batchSize: 100,
        transform,
      })

      bridge.emit('insert', 'users', { id: 1 })
      bridge.emit('delete', 'users', { id: 2 })
      bridge.emit('update', 'users', { id: 3 })
      await bridge.flush()

      // Only insert and update should be sent
      expect(mockPipeline.events).toHaveLength(2)
    })

    it('should filter events when transform returns undefined', async () => {
      const transform = (event: StreamEvent) => {
        if (event.table === 'internal') {
          return undefined
        }
        return event
      }

      bridge = new StreamBridge(mockPipeline as any, {
        batchSize: 100,
        transform,
      })

      bridge.emit('insert', 'users', { id: 1 })
      bridge.emit('insert', 'internal', { secret: 'data' })
      await bridge.flush()

      expect(mockPipeline.events).toHaveLength(1)
    })

    it('should provide event context to transform', async () => {
      let receivedEvent: StreamEvent | null = null
      const transform = (event: StreamEvent) => {
        receivedEvent = event
        return event
      }

      bridge = new StreamBridge(mockPipeline as any, {
        batchSize: 100,
        transform,
      })

      bridge.emit('insert', 'orders', { orderId: 123 })
      await bridge.flush()

      expect(receivedEvent).not.toBeNull()
      expect(receivedEvent!.operation).toBe('insert')
      expect(receivedEvent!.table).toBe('orders')
      expect(receivedEvent!.data).toEqual({ orderId: 123 })
      expect(receivedEvent!.timestamp).toBeDefined()
    })

    it('should allow enriching events with metadata', async () => {
      const transform = (event: StreamEvent) => ({
        ...event,
        metadata: {
          source: 'api-gateway',
          version: '2.0',
        },
      })

      bridge = new StreamBridge(mockPipeline as any, {
        batchSize: 100,
        transform,
      })

      bridge.emit('insert', 'events', { type: 'click' })
      await bridge.flush()

      const events = mockPipeline.events as any[]
      expect(events[0].metadata).toEqual({
        source: 'api-gateway',
        version: '2.0',
      })
    })

    it('should handle transform errors gracefully', async () => {
      const transform = (event: StreamEvent) => {
        if (event.data && (event.data as any).triggerError) {
          throw new Error('Transform failed')
        }
        return event
      }

      bridge = new StreamBridge(mockPipeline as any, {
        batchSize: 100,
        transform,
      })

      bridge.emit('insert', 'safe', { id: 1 })
      bridge.emit('insert', 'unsafe', { triggerError: true })
      bridge.emit('insert', 'safe', { id: 2 })

      // Should not throw, should handle gracefully
      await expect(bridge.flush()).resolves.not.toThrow()

      // Safe events should still be sent (behavior depends on implementation)
      expect(mockPipeline.events.length).toBeGreaterThanOrEqual(1)
    })

    it('should not apply transform if not configured', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        batchSize: 100,
        // No transform
      })

      bridge.emit('insert', 'users', { id: 1 })
      await bridge.flush()

      const events = mockPipeline.events as StreamEvent[]
      expect(events[0]).not.toHaveProperty('transformed')
    })
  })

  // ============================================================================
  // FLUSH TESTS
  // ============================================================================

  describe('flush', () => {
    beforeEach(() => {
      bridge = new StreamBridge(mockPipeline as any, {
        batchSize: 100,
        flushInterval: 60_000,
      })
    })

    it('should send all buffered events', async () => {
      bridge.emit('insert', 'users', { id: 1 })
      bridge.emit('insert', 'users', { id: 2 })
      bridge.emit('insert', 'users', { id: 3 })

      await bridge.flush()

      expect(mockPipeline.send).toHaveBeenCalledTimes(1)
      expect(mockPipeline.events).toHaveLength(3)
    })

    it('should clear buffer after flush', async () => {
      bridge.emit('insert', 'users', { id: 1 })
      await bridge.flush()

      expect(bridge.bufferSize).toBe(0)
      expect(bridge.bufferBytes).toBe(0)
    })

    it('should not send if buffer is empty', async () => {
      await bridge.flush()

      expect(mockPipeline.send).not.toHaveBeenCalled()
    })

    it('should return promise that resolves on success', async () => {
      bridge.emit('insert', 'users', { id: 1 })

      const result = await bridge.flush()
      expect(result).toBeUndefined()
    })

    it('should handle concurrent flush calls', async () => {
      bridge.emit('insert', 'users', { id: 1 })
      bridge.emit('insert', 'users', { id: 2 })

      // Call flush concurrently
      await Promise.all([bridge.flush(), bridge.flush()])

      // Should only send once (events taken by first flush)
      expect(mockPipeline.send).toHaveBeenCalledTimes(1)
    })

    it('should preserve event order in batch', async () => {
      for (let i = 0; i < 10; i++) {
        bridge.emit('insert', 'events', { order: i })
      }

      await bridge.flush()

      const events = mockPipeline.events as StreamEvent[]
      for (let i = 0; i < 10; i++) {
        expect((events[i].data as any).order).toBe(i)
      }
    })
  })

  // ============================================================================
  // CLOSE TESTS
  // ============================================================================

  describe('close', () => {
    it('should flush remaining events on close', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        batchSize: 100,
        flushInterval: 60_000,
      })

      bridge.emit('insert', 'users', { id: 1 })
      bridge.emit('insert', 'users', { id: 2 })

      await bridge.close()

      expect(mockPipeline.send).toHaveBeenCalledTimes(1)
      expect(mockPipeline.events).toHaveLength(2)
    })

    it('should stop accepting events after close', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        batchSize: 100,
      })

      await bridge.close()

      bridge.emit('insert', 'users', { id: 1 })
      expect(bridge.bufferSize).toBe(0)
    })

    it('should be idempotent (multiple close calls)', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        batchSize: 100,
      })

      bridge.emit('insert', 'users', { id: 1 })

      await bridge.close()
      await bridge.close()
      await bridge.close()

      // Should only flush once
      expect(mockPipeline.send).toHaveBeenCalledTimes(1)
    })

    it('should stop interval timer on close', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        batchSize: 100,
        flushInterval: 1_000,
      })

      bridge.emit('insert', 'users', { id: 1 })
      await bridge.close()

      // Clear mock to check for future calls
      mockPipeline.clear()

      // Advance time - should not trigger any more flushes
      await vi.advanceTimersByTimeAsync(5_000)
      expect(mockPipeline.send).not.toHaveBeenCalled()
    })

    it('should return promise that resolves when close is complete', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        batchSize: 100,
      })

      bridge.emit('insert', 'users', { id: 1 })

      const closePromise = bridge.close()
      expect(closePromise).toBeInstanceOf(Promise)
      await expect(closePromise).resolves.toBeUndefined()
    })
  })

  // ============================================================================
  // ERROR HANDLING TESTS
  // ============================================================================

  describe('error handling', () => {
    it('should retry on pipeline error', async () => {
      mockPipeline.setError(new Error('Temporary failure'))

      bridge = new StreamBridge(mockPipeline as any, {
        batchSize: 100,
        maxRetries: 3,
        retryDelay: 100,
      })

      bridge.emit('insert', 'users', { id: 1 })

      // First 2 calls fail, then succeed
      mockPipeline.send
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockRejectedValueOnce(new Error('Fail 2'))
        .mockResolvedValueOnce(undefined)
      mockPipeline.setError(null)

      await bridge.flush()

      expect(mockPipeline.send).toHaveBeenCalledTimes(3)
    })

    it('should call error handler after max retries', async () => {
      const onError = vi.fn()
      mockPipeline.setError(new Error('Persistent failure'))

      bridge = new StreamBridge(mockPipeline as any, {
        batchSize: 100,
        maxRetries: 2,
        retryDelay: 10,
        onError,
      })

      bridge.emit('insert', 'users', { id: 1 })
      await bridge.flush()

      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.arrayContaining([expect.objectContaining({ operation: 'insert' })])
      )
    })

    it('should not throw on flush error by default', async () => {
      mockPipeline.setError(new Error('Pipeline unavailable'))

      bridge = new StreamBridge(mockPipeline as any, {
        batchSize: 100,
        maxRetries: 1,
        retryDelay: 0,
      })

      bridge.emit('insert', 'users', { id: 1 })

      await expect(bridge.flush()).resolves.not.toThrow()
    })

    it('should use exponential backoff for retries', async () => {
      const callTimes: number[] = []
      mockPipeline.send.mockImplementation(async () => {
        callTimes.push(Date.now())
        throw new Error('Fail')
      })

      bridge = new StreamBridge(mockPipeline as any, {
        batchSize: 100,
        maxRetries: 3,
        retryDelay: 100,
        exponentialBackoff: true,
      })

      bridge.emit('insert', 'users', { id: 1 })

      const startTime = Date.now()
      await bridge.flush()

      // With exponential backoff: 100ms, 200ms, 400ms between retries
      // Total time should be at least 100 + 200 = 300ms (for 3 retries, 2 delays)
      expect(callTimes.length).toBe(3)
    })

    it('should preserve failed events for retry', async () => {
      let attemptCount = 0
      mockPipeline.send.mockImplementation(async (events) => {
        attemptCount++
        if (attemptCount < 3) {
          throw new Error(`Attempt ${attemptCount} failed`)
        }
        mockPipeline.events.push(...events)
      })

      bridge = new StreamBridge(mockPipeline as any, {
        batchSize: 100,
        maxRetries: 3,
        retryDelay: 10,
      })

      bridge.emit('insert', 'users', { id: 1 })
      bridge.emit('insert', 'users', { id: 2 })
      await bridge.flush()

      // Events should be sent on successful retry
      expect(mockPipeline.events).toHaveLength(2)
    })

    it('should handle close errors gracefully', async () => {
      mockPipeline.setError(new Error('Close failure'))

      bridge = new StreamBridge(mockPipeline as any, {
        batchSize: 100,
        maxRetries: 1,
        retryDelay: 0,
      })

      bridge.emit('insert', 'users', { id: 1 })

      // Should not throw
      await expect(bridge.close()).resolves.not.toThrow()
    })
  })

  // ============================================================================
  // PROPERTY ACCESSOR TESTS
  // ============================================================================

  describe('property accessors', () => {
    beforeEach(() => {
      bridge = new StreamBridge(mockPipeline as any, {
        batchSize: 100,
      })
    })

    it('should expose bufferSize', () => {
      expect(bridge.bufferSize).toBe(0)

      bridge.emit('insert', 'users', { id: 1 })
      expect(bridge.bufferSize).toBe(1)

      bridge.emit('insert', 'users', { id: 2 })
      expect(bridge.bufferSize).toBe(2)
    })

    it('should expose bufferBytes', () => {
      expect(bridge.bufferBytes).toBe(0)

      bridge.emit('insert', 'users', { id: 1, name: 'Alice' })
      expect(bridge.bufferBytes).toBeGreaterThan(0)
    })

    it('should expose pending flag', () => {
      expect(bridge.pending).toBe(false)

      bridge.emit('insert', 'users', { id: 1 })
      expect(bridge.pending).toBe(true)
    })

    it('should expose closed flag', async () => {
      expect(bridge.closed).toBe(false)

      await bridge.close()
      expect(bridge.closed).toBe(true)
    })

    it('should expose config as readonly', () => {
      expect(bridge.config).toBeDefined()
      expect(bridge.config.batchSize).toBe(100)

      // Should not be able to mutate (TypeScript check, runtime may vary)
      expect(() => {
        ;(bridge.config as any).batchSize = 999
      }).toThrow()
    })
  })

  // ============================================================================
  // INTEGRATION TESTS
  // ============================================================================

  describe('integration scenarios', () => {
    it('should work with realistic CDC pattern', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        sink: 'parquet',
        batchSize: 1000,
        flushInterval: 60_000,
      })

      // Simulate database transaction
      bridge.emit('insert', 'orders', { id: 1, customerId: 100, total: 250.00 })
      bridge.emit('insert', 'order_items', { orderId: 1, productId: 10, qty: 2 })
      bridge.emit('insert', 'order_items', { orderId: 1, productId: 20, qty: 1 })
      bridge.emit('update', 'inventory', { productId: 10, stock: 48 })
      bridge.emit('update', 'inventory', { productId: 20, stock: 99 })

      // Flush at transaction commit
      await bridge.flush()

      expect(mockPipeline.events).toHaveLength(5)

      // All events should have partition key
      const events = mockPipeline.events as any[]
      events.forEach((event) => {
        expect(event._partition_hour).toBeDefined()
      })
    })

    it('should handle high-throughput event stream', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        batchSize: 100,
        flushInterval: 1_000,
      })

      // Emit many events rapidly
      for (let i = 0; i < 500; i++) {
        bridge.emit('insert', 'clicks', { userId: i % 100, page: '/home' })
      }

      // Should have triggered multiple batch flushes
      await vi.advanceTimersByTimeAsync(100)

      expect(mockPipeline.send).toHaveBeenCalledTimes(5) // 500 / 100 = 5 batches
      expect(mockPipeline.events).toHaveLength(500)
    })

    it('should work with analytics event pattern', async () => {
      vi.setSystemTime(new Date('2026-01-09T15:30:00Z'))

      bridge = new StreamBridge(mockPipeline as any, {
        sink: 'parquet',
        batchSize: 100,
        transform: (event: StreamEvent) => ({
          ...event,
          _partition_hour: '2026-01-09-15',
          _source: 'web-analytics',
        }),
      })

      bridge.emit('insert', 'page_views', { url: '/products', duration: 5000 })
      bridge.emit('insert', 'page_views', { url: '/checkout', duration: 3000 })
      await bridge.flush()

      const events = mockPipeline.events as any[]
      expect(events[0]._source).toBe('web-analytics')
      expect(events[0]._partition_hour).toBe('2026-01-09-15')
    })

    it('should support mixed operation types', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        batchSize: 100,
      })

      bridge.emit('insert', 'users', { id: 1, name: 'Alice' })
      bridge.emit('update', 'users', { id: 1, name: 'Alice Updated' })
      bridge.emit('delete', 'users', { id: 1 })
      bridge.emit('insert', 'users', { id: 2, name: 'Bob' })

      await bridge.flush()

      const events = mockPipeline.events as StreamEvent[]
      expect(events.map((e) => e.operation)).toEqual(['insert', 'update', 'delete', 'insert'])
    })
  })
})
