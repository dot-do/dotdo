/**
 * StreamBridge tests
 *
 * Tests for Cloudflare Pipelines integration:
 * - emit() for CRUD operations (insert/update/delete)
 * - Batching logic with configurable size
 * - Flush behavior (auto and manual)
 * - Pipeline binding integration
 * - Transform functions
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { StreamConfig } from './stream'
import { StreamBridge, createStreamEvent } from './stream'

// ============================================================================
// MOCK PIPELINE
// ============================================================================

const createMockPipeline = () => ({
  send: vi.fn().mockResolvedValue(undefined),
})

// ============================================================================
// STREAM EVENT TESTS
// ============================================================================

describe('createStreamEvent', () => {
  it('should create insert event', () => {
    const event = createStreamEvent('insert', 'users', { id: 1, name: 'Alice' })

    expect(event.operation).toBe('insert')
    expect(event.table).toBe('users')
    expect(event.data).toEqual({ id: 1, name: 'Alice' })
    expect(event.timestamp).toBeDefined()
    expect(typeof event.timestamp).toBe('number')
  })

  it('should create update event', () => {
    const event = createStreamEvent('update', 'users', { id: 1, name: 'Bob' }, { id: 1, name: 'Alice' })

    expect(event.operation).toBe('update')
    expect(event.table).toBe('users')
    expect(event.data).toEqual({ id: 1, name: 'Bob' })
    expect(event.previous).toEqual({ id: 1, name: 'Alice' })
  })

  it('should create delete event', () => {
    const event = createStreamEvent('delete', 'users', { id: 1, name: 'Alice' })

    expect(event.operation).toBe('delete')
    expect(event.table).toBe('users')
    expect(event.data).toEqual({ id: 1, name: 'Alice' })
  })

  it('should include metadata if provided', () => {
    const event = createStreamEvent('insert', 'orders', { id: 1 }, undefined, {
      source: 'api',
      userId: 'user-123',
    })

    expect(event.metadata).toEqual({
      source: 'api',
      userId: 'user-123',
    })
  })
})

// ============================================================================
// STREAM BRIDGE TESTS
// ============================================================================

describe('StreamBridge', () => {
  let mockPipeline: ReturnType<typeof createMockPipeline>
  let bridge: StreamBridge

  beforeEach(() => {
    mockPipeline = createMockPipeline()
  })

  afterEach(() => {
    if (bridge) {
      bridge.destroy()
    }
  })

  describe('constructor', () => {
    it('should create with pipeline binding', () => {
      bridge = new StreamBridge(mockPipeline as any)
      expect(bridge).toBeInstanceOf(StreamBridge)
    })

    it('should accept custom config', () => {
      const config: StreamConfig = {
        pipeline: 'EVENTS',
        sink: 'parquet',
        batchSize: 500,
        flushInterval: 30000,
      }
      bridge = new StreamBridge(mockPipeline as any, config)
      expect(bridge.config.batchSize).toBe(500)
      expect(bridge.config.flushInterval).toBe(30000)
    })
  })

  describe('emit', () => {
    it('should add events to buffer', () => {
      bridge = new StreamBridge(mockPipeline as any, {
        sink: 'iceberg',
        batchSize: 100,
      })

      bridge.emit('insert', 'users', { id: 1 })
      bridge.emit('insert', 'users', { id: 2 })

      expect(bridge.bufferSize).toBe(2)
    })

    it('should auto-flush when batch size reached', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        sink: 'iceberg',
        batchSize: 3,
      })

      bridge.emit('insert', 'users', { id: 1 })
      bridge.emit('insert', 'users', { id: 2 })
      expect(mockPipeline.send).not.toHaveBeenCalled()

      bridge.emit('insert', 'users', { id: 3 })

      // Wait for async flush to complete
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(mockPipeline.send).toHaveBeenCalledTimes(1)
      expect(mockPipeline.send).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ operation: 'insert', table: 'users' }),
        ])
      )
    })

    it('should support different operations', () => {
      bridge = new StreamBridge(mockPipeline as any, {
        sink: 'iceberg',
        batchSize: 100,
      })

      bridge.emit('insert', 'users', { id: 1 })
      bridge.emit('update', 'users', { id: 1, name: 'Alice' })
      bridge.emit('delete', 'users', { id: 1 })

      expect(bridge.bufferSize).toBe(3)
    })
  })

  describe('flush', () => {
    it('should send all buffered events', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        sink: 'iceberg',
        batchSize: 100,
      })

      bridge.emit('insert', 'users', { id: 1 })
      bridge.emit('insert', 'users', { id: 2 })

      await bridge.flush()

      expect(mockPipeline.send).toHaveBeenCalledTimes(1)
      expect(mockPipeline.send.mock.calls[0][0]).toHaveLength(2)
    })

    it('should clear buffer after flush', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        sink: 'iceberg',
        batchSize: 100,
      })

      bridge.emit('insert', 'users', { id: 1 })
      await bridge.flush()

      expect(bridge.bufferSize).toBe(0)
    })

    it('should not send if buffer is empty', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        sink: 'iceberg',
      })

      await bridge.flush()

      expect(mockPipeline.send).not.toHaveBeenCalled()
    })
  })

  describe('auto flush interval', () => {
    it('should flush at configured interval', async () => {
      vi.useFakeTimers()

      bridge = new StreamBridge(mockPipeline as any, {
        sink: 'iceberg',
        batchSize: 1000,
        flushInterval: 5000,
      })
      bridge.startAutoFlush()

      bridge.emit('insert', 'users', { id: 1 })
      expect(mockPipeline.send).not.toHaveBeenCalled()

      // Advance time past the interval
      await vi.advanceTimersByTimeAsync(5000)

      expect(mockPipeline.send).toHaveBeenCalledTimes(1)

      vi.useRealTimers()
    })

    it('should stop auto-flush when destroyed', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        sink: 'iceberg',
        flushInterval: 5000,
      })

      bridge.emit('insert', 'users', { id: 1 })
      bridge.destroy()

      // Buffer should have been flushed on destroy
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(mockPipeline.send).toHaveBeenCalledTimes(1)
    })
  })

  describe('transform', () => {
    it('should apply transform function to events', async () => {
      const transform = vi.fn((event: any) => ({
        ...event,
        transformed: true,
      }))

      bridge = new StreamBridge(mockPipeline as any, {
        sink: 'iceberg',
        batchSize: 100,
        transform,
      })

      bridge.emit('insert', 'users', { id: 1 })
      await bridge.flush()

      expect(transform).toHaveBeenCalled()
      expect(mockPipeline.send.mock.calls[0][0][0]).toHaveProperty('transformed', true)
    })

    it('should filter events when transform returns null', async () => {
      const transform = vi.fn((event: any) => {
        // Filter out deletes
        return event.operation === 'delete' ? null : event
      })

      bridge = new StreamBridge(mockPipeline as any, {
        sink: 'iceberg',
        batchSize: 100,
        transform,
      })

      bridge.emit('insert', 'users', { id: 1 })
      bridge.emit('delete', 'users', { id: 2 })
      bridge.emit('insert', 'users', { id: 3 })

      await bridge.flush()

      // Only 2 events should be sent (inserts)
      expect(mockPipeline.send.mock.calls[0][0]).toHaveLength(2)
    })
  })

  describe('sink formatting', () => {
    it('should format for iceberg sink', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        sink: 'iceberg',
        batchSize: 100,
      })

      bridge.emit('insert', 'users', { id: 1 })
      await bridge.flush()

      const events = mockPipeline.send.mock.calls[0][0]
      // Iceberg events should have standard format
      expect(events[0]).toHaveProperty('operation')
      expect(events[0]).toHaveProperty('table')
      expect(events[0]).toHaveProperty('timestamp')
    })

    it('should format for json sink', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        sink: 'json',
        batchSize: 100,
      })

      bridge.emit('insert', 'users', { id: 1 })
      await bridge.flush()

      const events = mockPipeline.send.mock.calls[0][0]
      // JSON events have the same format
      expect(events[0]).toHaveProperty('operation')
    })
  })

  describe('error handling', () => {
    it('should handle pipeline errors gracefully', async () => {
      mockPipeline.send.mockRejectedValueOnce(new Error('Pipeline unavailable'))

      bridge = new StreamBridge(
        mockPipeline as any,
        {
          sink: 'iceberg',
          batchSize: 100,
        },
        { maxRetries: 1, retryDelay: 0 }
      )

      bridge.emit('insert', 'users', { id: 1 })

      // Should not throw
      await expect(bridge.flush()).resolves.not.toThrow()
    })

    it('should retry on failure', async () => {
      mockPipeline.send
        .mockRejectedValueOnce(new Error('Temporary error'))
        .mockResolvedValueOnce(undefined)

      bridge = new StreamBridge(
        mockPipeline as any,
        {
          sink: 'iceberg',
          batchSize: 100,
        },
        { maxRetries: 3, retryDelay: 0 }
      )

      bridge.emit('insert', 'users', { id: 1 })
      await bridge.flush()

      // Should have retried
      expect(mockPipeline.send).toHaveBeenCalledTimes(2)
    })

    it('should call error handler on final failure', async () => {
      const onError = vi.fn()
      mockPipeline.send.mockRejectedValue(new Error('Persistent error'))

      bridge = new StreamBridge(
        mockPipeline as any,
        {
          sink: 'iceberg',
          batchSize: 100,
        },
        { onError, maxRetries: 2, retryDelay: 0 }
      )

      bridge.emit('insert', 'users', { id: 1 })
      await bridge.flush()

      expect(onError).toHaveBeenCalled()
    })
  })

  describe('bufferSize', () => {
    it('should return current buffer size', () => {
      bridge = new StreamBridge(mockPipeline as any, {
        sink: 'iceberg',
        batchSize: 100,
      })

      expect(bridge.bufferSize).toBe(0)

      bridge.emit('insert', 'users', { id: 1 })
      expect(bridge.bufferSize).toBe(1)

      bridge.emit('insert', 'users', { id: 2 })
      expect(bridge.bufferSize).toBe(2)
    })
  })

  describe('pending', () => {
    it('should return true when buffer has events', () => {
      bridge = new StreamBridge(mockPipeline as any, {
        sink: 'iceberg',
        batchSize: 100,
      })

      expect(bridge.pending).toBe(false)

      bridge.emit('insert', 'users', { id: 1 })
      expect(bridge.pending).toBe(true)
    })
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('StreamBridge integration', () => {
  it('should work with realistic CDC pattern', async () => {
    const mockPipeline = createMockPipeline()

    const bridge = new StreamBridge(mockPipeline as any, {
      sink: 'iceberg',
      batchSize: 1000,
      flushInterval: 60000,
    })

    // Simulate database changes
    bridge.emit('insert', 'orders', { id: 1, total: 100 })
    bridge.emit('update', 'orders', { id: 1, total: 150 })
    bridge.emit('insert', 'order_items', { orderId: 1, productId: 10 })

    // Flush on transaction commit
    await bridge.flush()

    expect(mockPipeline.send).toHaveBeenCalledTimes(1)
    expect(mockPipeline.send.mock.calls[0][0]).toHaveLength(3)

    bridge.destroy()
  })
})
