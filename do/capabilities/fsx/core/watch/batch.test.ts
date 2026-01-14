/**
 * Tests for BatchEmitter - batch event emission
 *
 * These tests verify the batch emission functionality:
 * - Events are batched within the configured window
 * - Max batch size triggers immediate emission
 * - Event priority ordering works correctly
 * - Event compression/coalescing reduces duplicates
 * - Metrics tracking is accurate
 * - Cleanup properly disposes resources
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { BatchEmitter, EVENT_PRIORITY, createBatchEmitter } from './batch'
import type { WatchEvent } from './events'

describe('BatchEmitter', () => {
  let emitter: BatchEmitter
  let callback: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    emitter = new BatchEmitter()
    callback = vi.fn()
  })

  afterEach(() => {
    emitter.dispose()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('Batching', () => {
    it('should batch events within the batch window', async () => {
      emitter.onBatch(callback)

      // Queue multiple events
      emitter.queue('create', '/file1.txt')
      emitter.queue('modify', '/file2.txt')
      emitter.queue('delete', '/file3.txt')

      // Before batch window expires, no emission
      await vi.advanceTimersByTimeAsync(5)
      expect(callback).not.toHaveBeenCalled()

      // After batch window, single batch emitted
      await vi.advanceTimersByTimeAsync(10)
      expect(callback).toHaveBeenCalledTimes(1)

      const events = callback.mock.calls[0][0] as WatchEvent[]
      expect(events).toHaveLength(3)
    })

    it('should respect custom batch window', async () => {
      emitter = new BatchEmitter({ batchWindowMs: 50 })
      emitter.onBatch(callback)

      emitter.queue('create', '/file.txt')

      // At 10ms (default would emit), still waiting
      await vi.advanceTimersByTimeAsync(10)
      expect(callback).not.toHaveBeenCalled()

      // At 60ms, should emit
      await vi.advanceTimersByTimeAsync(50)
      expect(callback).toHaveBeenCalledTimes(1)
    })

    it('should emit immediately when max batch size is reached', async () => {
      emitter = new BatchEmitter({ maxBatchSize: 3 })
      emitter.onBatch(callback)

      emitter.queue('create', '/file1.txt')
      emitter.queue('modify', '/file2.txt')

      // Not yet at max
      expect(callback).not.toHaveBeenCalled()

      // This should trigger immediate emission
      emitter.queue('delete', '/file3.txt')
      expect(callback).toHaveBeenCalledTimes(1)
    })

    it('should allow multiple batch callbacks', async () => {
      const callback2 = vi.fn()
      emitter.onBatch(callback)
      emitter.onBatch(callback2)

      emitter.queue('create', '/file.txt')
      await vi.advanceTimersByTimeAsync(15)

      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback2).toHaveBeenCalledTimes(1)
    })

    it('should support unsubscribing callbacks', async () => {
      const unsubscribe = emitter.onBatch(callback)

      emitter.queue('create', '/file1.txt')
      await vi.advanceTimersByTimeAsync(15)
      expect(callback).toHaveBeenCalledTimes(1)

      // Unsubscribe
      unsubscribe()

      // New events should not trigger callback
      emitter.queue('create', '/file2.txt')
      await vi.advanceTimersByTimeAsync(15)
      expect(callback).toHaveBeenCalledTimes(1) // Still 1
    })
  })

  describe('Event Priority', () => {
    it('should sort events by priority (delete > create > modify)', async () => {
      emitter = new BatchEmitter({ compressEvents: false, prioritizeEvents: true })
      emitter.onBatch(callback)

      // Queue in mixed order
      emitter.queue('modify', '/file1.txt')
      emitter.queue('create', '/file2.txt')
      emitter.queue('delete', '/file3.txt')
      emitter.queue('rename', '/file4.txt')

      emitter.flush()

      const events = callback.mock.calls[0][0] as WatchEvent[]
      expect(events[0].type).toBe('delete')
      expect(events[1].type).toBe('rename')
      expect(events[2].type).toBe('create')
      expect(events[3].type).toBe('modify')
    })

    it('should have correct priority values', () => {
      expect(EVENT_PRIORITY.delete).toBeGreaterThan(EVENT_PRIORITY.rename)
      expect(EVENT_PRIORITY.rename).toBeGreaterThan(EVENT_PRIORITY.create)
      expect(EVENT_PRIORITY.create).toBeGreaterThan(EVENT_PRIORITY.modify)
    })

    it('should disable priority sorting when configured', async () => {
      emitter = new BatchEmitter({ compressEvents: false, prioritizeEvents: false })
      emitter.onBatch(callback)

      // Queue in specific order
      emitter.queue('modify', '/file1.txt')
      emitter.queue('delete', '/file2.txt')
      emitter.queue('create', '/file3.txt')

      emitter.flush()

      const events = callback.mock.calls[0][0] as WatchEvent[]
      // Should be in queue order, not priority order
      expect(events[0].type).toBe('modify')
      expect(events[1].type).toBe('delete')
      expect(events[2].type).toBe('create')
    })
  })

  describe('Event Compression', () => {
    it('should coalesce multiple events to same path', async () => {
      emitter = new BatchEmitter({ compressEvents: true })
      emitter.onBatch(callback)

      // Multiple events to same path
      emitter.queue('create', '/file.txt')
      emitter.queue('modify', '/file.txt')
      emitter.queue('modify', '/file.txt')

      emitter.flush()

      const events = callback.mock.calls[0][0] as WatchEvent[]
      // Should coalesce to single event
      expect(events).toHaveLength(1)
      // Create followed by modifies = create
      expect(events[0].type).toBe('create')
    })

    it('should apply create + modify = create coalescing', async () => {
      emitter = new BatchEmitter({ compressEvents: true })
      emitter.onBatch(callback)

      emitter.queue('create', '/file.txt')
      emitter.queue('modify', '/file.txt')

      emitter.flush()

      const events = callback.mock.calls[0][0] as WatchEvent[]
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('create')
    })

    it('should apply modify + delete = delete coalescing', async () => {
      emitter = new BatchEmitter({ compressEvents: true })
      emitter.onBatch(callback)

      emitter.queue('modify', '/file.txt')
      emitter.queue('delete', '/file.txt')

      emitter.flush()

      const events = callback.mock.calls[0][0] as WatchEvent[]
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('delete')
    })

    it('should not coalesce events to different paths', async () => {
      emitter = new BatchEmitter({ compressEvents: true })
      emitter.onBatch(callback)

      emitter.queue('modify', '/file1.txt')
      emitter.queue('modify', '/file2.txt')

      emitter.flush()

      const events = callback.mock.calls[0][0] as WatchEvent[]
      expect(events).toHaveLength(2)
    })

    it('should disable compression when configured', async () => {
      emitter = new BatchEmitter({ compressEvents: false, prioritizeEvents: false })
      emitter.onBatch(callback)

      emitter.queue('create', '/file.txt')
      emitter.queue('modify', '/file.txt')
      emitter.queue('modify', '/file.txt')

      emitter.flush()

      const events = callback.mock.calls[0][0] as WatchEvent[]
      // Without compression, all events are emitted
      expect(events).toHaveLength(3)
    })
  })

  describe('Metrics', () => {
    it('should track events received', async () => {
      emitter = new BatchEmitter({ enableMetrics: true })

      emitter.queue('create', '/file1.txt')
      emitter.queue('modify', '/file2.txt')
      emitter.queue('delete', '/file3.txt')

      const metrics = emitter.getMetrics()
      expect(metrics.eventsReceived).toBe(3)
    })

    it('should track events emitted after coalescing', async () => {
      emitter = new BatchEmitter({ enableMetrics: true, compressEvents: true })
      emitter.onBatch(callback)

      // 3 events to same path
      emitter.queue('create', '/file.txt')
      emitter.queue('modify', '/file.txt')
      emitter.queue('modify', '/file.txt')

      emitter.flush()

      const metrics = emitter.getMetrics()
      expect(metrics.eventsReceived).toBe(3)
      expect(metrics.eventsEmitted).toBe(1)
    })

    it('should track batches emitted', async () => {
      emitter = new BatchEmitter({ enableMetrics: true })
      emitter.onBatch(callback)

      emitter.queue('create', '/file1.txt')
      emitter.flush()

      emitter.queue('modify', '/file2.txt')
      emitter.flush()

      const metrics = emitter.getMetrics()
      expect(metrics.batchesEmitted).toBe(2)
    })

    it('should calculate average batch size', async () => {
      emitter = new BatchEmitter({ enableMetrics: true, compressEvents: false })
      emitter.onBatch(callback)

      // First batch: 2 events
      emitter.queue('create', '/file1.txt')
      emitter.queue('modify', '/file2.txt')
      emitter.flush()

      // Second batch: 4 events
      emitter.queue('create', '/file3.txt')
      emitter.queue('modify', '/file4.txt')
      emitter.queue('delete', '/file5.txt')
      emitter.queue('rename', '/file6.txt')
      emitter.flush()

      const metrics = emitter.getMetrics()
      expect(metrics.averageBatchSize).toBe(3) // (2 + 4) / 2
    })

    it('should calculate compression ratio', async () => {
      emitter = new BatchEmitter({ enableMetrics: true, compressEvents: true })
      emitter.onBatch(callback)

      // 4 events, coalesced to 2
      emitter.queue('create', '/file1.txt')
      emitter.queue('modify', '/file1.txt')
      emitter.queue('create', '/file2.txt')
      emitter.queue('modify', '/file2.txt')

      emitter.flush()

      const metrics = emitter.getMetrics()
      expect(metrics.compressionRatio).toBe(2) // 4 received / 2 emitted
    })

    it('should reset metrics', async () => {
      emitter = new BatchEmitter({ enableMetrics: true })
      emitter.onBatch(callback)

      emitter.queue('create', '/file.txt')
      emitter.flush()

      expect(emitter.getMetrics().eventsReceived).toBe(1)

      emitter.resetMetrics()

      expect(emitter.getMetrics().eventsReceived).toBe(0)
      expect(emitter.getMetrics().eventsEmitted).toBe(0)
      expect(emitter.getMetrics().batchesEmitted).toBe(0)
    })

    it('should track events per second', async () => {
      emitter = new BatchEmitter({ enableMetrics: true, compressEvents: false })
      emitter.onBatch(callback)

      // Emit 10 events
      for (let i = 0; i < 10; i++) {
        emitter.queue('create', `/file${i}.txt`)
      }
      emitter.flush()

      // Advance time by 1 second
      await vi.advanceTimersByTimeAsync(1000)

      const metrics = emitter.getMetrics()
      expect(metrics.eventsPerSecond).toBeGreaterThan(0)
    })
  })

  describe('Flush', () => {
    it('should immediately emit all pending events', async () => {
      emitter.onBatch(callback)

      emitter.queue('create', '/file1.txt')
      emitter.queue('modify', '/file2.txt')

      // No emission yet
      expect(callback).not.toHaveBeenCalled()

      // Force flush
      emitter.flush()

      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback.mock.calls[0][0]).toHaveLength(2)
    })

    it('should not emit if no pending events', async () => {
      emitter.onBatch(callback)
      emitter.flush()
      expect(callback).not.toHaveBeenCalled()
    })

    it('should clear batch timer on flush', async () => {
      emitter.onBatch(callback)

      emitter.queue('create', '/file.txt')

      // Timer is now set
      emitter.flush()
      expect(callback).toHaveBeenCalledTimes(1)

      // Advance past original timer - should not fire again
      await vi.advanceTimersByTimeAsync(20)
      expect(callback).toHaveBeenCalledTimes(1)
    })
  })

  describe('getPendingCount', () => {
    it('should return count of pending events', () => {
      expect(emitter.getPendingCount()).toBe(0)

      emitter.queue('create', '/file1.txt')
      expect(emitter.getPendingCount()).toBe(1)

      emitter.queue('modify', '/file2.txt')
      expect(emitter.getPendingCount()).toBe(2)
    })

    it('should return 0 after flush', () => {
      emitter.queue('create', '/file.txt')
      expect(emitter.getPendingCount()).toBe(1)

      emitter.flush()
      expect(emitter.getPendingCount()).toBe(0)
    })

    it('should count unique paths when compression is enabled', () => {
      emitter = new BatchEmitter({ compressEvents: true })

      emitter.queue('create', '/file.txt')
      emitter.queue('modify', '/file.txt')
      emitter.queue('modify', '/file.txt')

      // All to same path, so only 1 pending
      expect(emitter.getPendingCount()).toBe(1)
    })
  })

  describe('Configuration getters', () => {
    it('should return batch window', () => {
      expect(emitter.getBatchWindow()).toBe(10) // Default

      emitter = new BatchEmitter({ batchWindowMs: 50 })
      expect(emitter.getBatchWindow()).toBe(50)
    })

    it('should return max batch size', () => {
      expect(emitter.getMaxBatchSize()).toBe(100) // Default

      emitter = new BatchEmitter({ maxBatchSize: 25 })
      expect(emitter.getMaxBatchSize()).toBe(25)
    })
  })

  describe('Dispose', () => {
    it('should clear pending events', () => {
      emitter.queue('create', '/file.txt')
      expect(emitter.getPendingCount()).toBe(1)

      emitter.dispose()
      expect(emitter.getPendingCount()).toBe(0)
    })

    it('should clear timer and not emit after dispose', async () => {
      emitter.onBatch(callback)
      emitter.queue('create', '/file.txt')

      emitter.dispose()

      // Advance past batch window
      await vi.advanceTimersByTimeAsync(20)
      expect(callback).not.toHaveBeenCalled()
    })

    it('should clear callbacks', async () => {
      emitter.onBatch(callback)
      emitter.dispose()

      // Re-queue after dispose
      emitter.queue('create', '/file.txt')
      emitter.flush()

      expect(callback).not.toHaveBeenCalled()
    })
  })

  describe('createBatchEmitter factory', () => {
    it('should create emitter with default options', () => {
      const em = createBatchEmitter()
      expect(em.getBatchWindow()).toBe(10)
      expect(em.getMaxBatchSize()).toBe(100)
      em.dispose()
    })

    it('should create emitter with custom options', () => {
      const em = createBatchEmitter({ batchWindowMs: 25, maxBatchSize: 50 })
      expect(em.getBatchWindow()).toBe(25)
      expect(em.getMaxBatchSize()).toBe(50)
      em.dispose()
    })
  })

  describe('Error handling', () => {
    it('should not throw when callback throws', async () => {
      const errorCallback = vi.fn(() => {
        throw new Error('Callback error')
      })
      const goodCallback = vi.fn()

      emitter.onBatch(errorCallback)
      emitter.onBatch(goodCallback)

      emitter.queue('create', '/file.txt')

      // Should not throw
      expect(() => emitter.flush()).not.toThrow()

      // Good callback should still be called
      expect(goodCallback).toHaveBeenCalledTimes(1)
    })
  })

  describe('Event metadata', () => {
    it('should preserve event metadata', async () => {
      emitter = new BatchEmitter({ compressEvents: false })
      emitter.onBatch(callback)

      emitter.queue('create', '/file.txt', undefined, { size: 1024, isDirectory: false })
      emitter.flush()

      const events = callback.mock.calls[0][0] as WatchEvent[]
      expect(events[0].size).toBe(1024)
      expect(events[0].isDirectory).toBe(false)
    })

    it('should handle rename events with oldPath', async () => {
      emitter = new BatchEmitter({ compressEvents: false })
      emitter.onBatch(callback)

      emitter.queue('rename', '/new.txt', '/old.txt')
      emitter.flush()

      const events = callback.mock.calls[0][0] as WatchEvent[]
      expect(events[0].type).toBe('rename')
      expect(events[0].path).toBe('/new.txt')
      expect(events[0].oldPath).toBe('/old.txt')
    })
  })
})
