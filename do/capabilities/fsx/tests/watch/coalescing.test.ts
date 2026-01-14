/**
 * Tests for event coalescing/debouncing in WebSocket watch endpoint
 *
 * TDD RED phase - these tests specify the event coalescing behavior
 * for the WebSocket watch endpoint. Events should be coalesced before
 * being sent to clients to reduce network traffic and improve efficiency.
 *
 * Test cases:
 * - Multiple rapid writes coalesced to single event
 * - Configurable debounce interval
 * - Write then delete = single delete event
 * - Rename coalescing
 * - Events batched within window
 *
 * @module tests/watch/coalescing
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { WatchEvent, WatchEventType } from '../../core/watch/events'

// ============================================================================
// Event Coalescer Interface (to be implemented)
// ============================================================================

/**
 * Configuration for the event coalescer
 */
interface EventCoalescerConfig {
  /** Debounce interval in milliseconds */
  debounceMs?: number
  /** Maximum batch size before forcing emission */
  maxBatchSize?: number
  /** Maximum wait time before forcing emission */
  maxWaitMs?: number
}

/**
 * EventCoalescer batches and coalesces rapid file system events
 * before emitting them to WebSocket clients.
 *
 * This interface defines the expected API for the coalescer.
 */
interface EventCoalescer {
  /** Add an event to be coalesced */
  add(event: WatchEvent): void

  /** Set callback for when coalesced events are ready */
  onEmit(callback: (events: WatchEvent[]) => void): void

  /** Flush all pending events immediately */
  flush(): void

  /** Get the number of pending events */
  getPendingCount(): number

  /** Get or set the debounce interval */
  getDebounceMs(): number
  setDebounceMs(ms: number): void

  /** Dispose and clean up timers */
  dispose(): void
}

/**
 * Factory function to create an EventCoalescer
 * This will be imported from the actual implementation once created
 */
function createEventCoalescer(config?: EventCoalescerConfig): EventCoalescer {
  // This import will fail until the implementation exists
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { EventCoalescer } = require('../../core/watch/coalescer') as {
    EventCoalescer: new (config?: EventCoalescerConfig) => EventCoalescer
  }
  return new EventCoalescer(config)
}

/**
 * Helper to create a WatchEvent for testing
 */
function createTestEvent(
  type: WatchEventType,
  path: string,
  options: { oldPath?: string; timestamp?: number } = {}
): WatchEvent {
  return {
    type,
    path,
    timestamp: options.timestamp ?? Date.now(),
    ...(options.oldPath ? { oldPath: options.oldPath } : {}),
  }
}

// ============================================================================
// Event Coalescing Tests
// ============================================================================

describe('EventCoalescer - WebSocket Watch Event Coalescing', () => {
  let coalescer: EventCoalescer
  let emittedEvents: WatchEvent[][]
  let emitCallback: (events: WatchEvent[]) => void

  beforeEach(() => {
    vi.useFakeTimers()
    emittedEvents = []
    emitCallback = (events) => emittedEvents.push(events)
  })

  afterEach(() => {
    if (coalescer) {
      coalescer.dispose()
    }
    vi.useRealTimers()
  })

  describe('Multiple rapid writes coalesced to single event', () => {
    it('should coalesce multiple rapid modify events for the same file into one', async () => {
      coalescer = createEventCoalescer({ debounceMs: 50 })
      coalescer.onEmit(emitCallback)

      // Rapid writes to the same file
      coalescer.add(createTestEvent('modify', '/home/user/file.txt'))
      coalescer.add(createTestEvent('modify', '/home/user/file.txt'))
      coalescer.add(createTestEvent('modify', '/home/user/file.txt'))
      coalescer.add(createTestEvent('modify', '/home/user/file.txt'))
      coalescer.add(createTestEvent('modify', '/home/user/file.txt'))

      // No events emitted yet
      expect(emittedEvents).toHaveLength(0)

      // After debounce window
      await vi.advanceTimersByTimeAsync(100)

      // Should have emitted exactly one batch with one event
      expect(emittedEvents).toHaveLength(1)
      expect(emittedEvents[0]).toHaveLength(1)
      expect(emittedEvents[0][0].type).toBe('modify')
      expect(emittedEvents[0][0].path).toBe('/home/user/file.txt')
    })

    it('should not coalesce events for different files', async () => {
      coalescer = createEventCoalescer({ debounceMs: 50 })
      coalescer.onEmit(emitCallback)

      // Writes to different files
      coalescer.add(createTestEvent('modify', '/home/user/file1.txt'))
      coalescer.add(createTestEvent('modify', '/home/user/file2.txt'))
      coalescer.add(createTestEvent('modify', '/home/user/file3.txt'))

      // After debounce window
      await vi.advanceTimersByTimeAsync(100)

      // Should have emitted one batch with three separate events
      expect(emittedEvents).toHaveLength(1)
      expect(emittedEvents[0]).toHaveLength(3)

      const paths = emittedEvents[0].map((e) => e.path)
      expect(paths).toContain('/home/user/file1.txt')
      expect(paths).toContain('/home/user/file2.txt')
      expect(paths).toContain('/home/user/file3.txt')
    })

    it('should reset debounce timer on each new event for the same file', async () => {
      coalescer = createEventCoalescer({ debounceMs: 50 })
      coalescer.onEmit(emitCallback)

      // First event
      coalescer.add(createTestEvent('modify', '/home/user/file.txt'))

      // Wait 30ms, then add another event (resets timer)
      await vi.advanceTimersByTimeAsync(30)
      coalescer.add(createTestEvent('modify', '/home/user/file.txt'))

      // At 60ms from start (30ms after second event), no emission yet
      await vi.advanceTimersByTimeAsync(30)
      expect(emittedEvents).toHaveLength(0)

      // At 90ms from start (60ms after second event), still no emission
      await vi.advanceTimersByTimeAsync(10)
      expect(emittedEvents).toHaveLength(0)

      // At 100ms from start (70ms after second event, past 50ms debounce)
      await vi.advanceTimersByTimeAsync(20)
      expect(emittedEvents).toHaveLength(1)
    })
  })

  describe('Configurable debounce interval', () => {
    it('should use custom debounce interval from config', async () => {
      coalescer = createEventCoalescer({ debounceMs: 200 })
      coalescer.onEmit(emitCallback)

      coalescer.add(createTestEvent('modify', '/file.txt'))

      // At 100ms (default would have emitted), no emission
      await vi.advanceTimersByTimeAsync(100)
      expect(emittedEvents).toHaveLength(0)

      // At 250ms (past 200ms debounce), should emit
      await vi.advanceTimersByTimeAsync(150)
      expect(emittedEvents).toHaveLength(1)
    })

    it('should allow changing debounce interval at runtime', async () => {
      coalescer = createEventCoalescer({ debounceMs: 50 })
      coalescer.onEmit(emitCallback)

      expect(coalescer.getDebounceMs()).toBe(50)

      coalescer.setDebounceMs(100)
      expect(coalescer.getDebounceMs()).toBe(100)

      coalescer.add(createTestEvent('modify', '/file.txt'))

      // At 60ms (original debounce would emit), no emission
      await vi.advanceTimersByTimeAsync(60)
      expect(emittedEvents).toHaveLength(0)

      // At 150ms (past new debounce), should emit
      await vi.advanceTimersByTimeAsync(90)
      expect(emittedEvents).toHaveLength(1)
    })

    it('should support zero debounce (immediate batching on next tick)', async () => {
      coalescer = createEventCoalescer({ debounceMs: 0 })
      coalescer.onEmit(emitCallback)

      coalescer.add(createTestEvent('modify', '/file.txt'))

      // Should emit on next tick
      await vi.advanceTimersByTimeAsync(1)
      expect(emittedEvents).toHaveLength(1)
    })

    it('should use default debounce interval when not specified', async () => {
      coalescer = createEventCoalescer()
      coalescer.onEmit(emitCallback)

      // Default should be something reasonable (e.g., 50ms)
      const defaultDebounce = coalescer.getDebounceMs()
      expect(defaultDebounce).toBeGreaterThan(0)
      expect(defaultDebounce).toBeLessThanOrEqual(100)
    })
  })

  describe('Write then delete = single delete event', () => {
    it('should emit only delete event when modify is followed by delete', async () => {
      coalescer = createEventCoalescer({ debounceMs: 50 })
      coalescer.onEmit(emitCallback)

      // Modify followed by delete
      coalescer.add(createTestEvent('modify', '/home/user/temp.txt'))
      coalescer.add(createTestEvent('modify', '/home/user/temp.txt'))
      coalescer.add(createTestEvent('delete', '/home/user/temp.txt'))

      await vi.advanceTimersByTimeAsync(100)

      // Should emit only one delete event
      expect(emittedEvents).toHaveLength(1)
      expect(emittedEvents[0]).toHaveLength(1)
      expect(emittedEvents[0][0].type).toBe('delete')
      expect(emittedEvents[0][0].path).toBe('/home/user/temp.txt')
    })

    it('should emit only delete event when create is followed by delete', async () => {
      coalescer = createEventCoalescer({ debounceMs: 50 })
      coalescer.onEmit(emitCallback)

      // Create, then delete (file never really existed from observer's perspective)
      coalescer.add(createTestEvent('create', '/home/user/temp.txt'))
      coalescer.add(createTestEvent('delete', '/home/user/temp.txt'))

      await vi.advanceTimersByTimeAsync(100)

      // When create is followed by delete, the net effect is nothing happened
      // Two options: emit nothing, or emit delete. For simplicity, emit delete.
      expect(emittedEvents).toHaveLength(1)
      expect(emittedEvents[0]).toHaveLength(1)
      expect(emittedEvents[0][0].type).toBe('delete')
    })

    it('should preserve delete event even with subsequent modify attempts', async () => {
      coalescer = createEventCoalescer({ debounceMs: 50 })
      coalescer.onEmit(emitCallback)

      // Delete, then someone tries to write (but file is gone)
      // In practice this might be a race condition, but delete should win
      coalescer.add(createTestEvent('delete', '/home/user/file.txt'))
      coalescer.add(createTestEvent('modify', '/home/user/file.txt'))

      await vi.advanceTimersByTimeAsync(100)

      // Delete should be the final event since it happened first
      // OR we could emit the modify since it happened last
      // The semantic depends on the use case - for notification purposes,
      // emitting both or the final state makes sense
      expect(emittedEvents).toHaveLength(1)
      // This test documents the expected behavior - implementation should decide
      const events = emittedEvents[0]
      expect(events.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Rename coalescing', () => {
    it('should preserve rename event with oldPath and newPath', async () => {
      coalescer = createEventCoalescer({ debounceMs: 50 })
      coalescer.onEmit(emitCallback)

      // Rename event
      coalescer.add(createTestEvent('rename', '/home/user/new-name.txt', { oldPath: '/home/user/old-name.txt' }))

      await vi.advanceTimersByTimeAsync(100)

      expect(emittedEvents).toHaveLength(1)
      expect(emittedEvents[0]).toHaveLength(1)
      expect(emittedEvents[0][0].type).toBe('rename')
      expect(emittedEvents[0][0].path).toBe('/home/user/new-name.txt')
      expect(emittedEvents[0][0].oldPath).toBe('/home/user/old-name.txt')
    })

    it('should coalesce rename followed by modify to single rename with modify metadata', async () => {
      coalescer = createEventCoalescer({ debounceMs: 50 })
      coalescer.onEmit(emitCallback)

      // Rename then modify
      coalescer.add(createTestEvent('rename', '/home/user/new.txt', { oldPath: '/home/user/old.txt' }))
      coalescer.add(createTestEvent('modify', '/home/user/new.txt'))

      await vi.advanceTimersByTimeAsync(100)

      // Should emit one event - the rename (since that's the significant change)
      expect(emittedEvents).toHaveLength(1)
      expect(emittedEvents[0]).toHaveLength(1)
      expect(emittedEvents[0][0].type).toBe('rename')
      expect(emittedEvents[0][0].oldPath).toBe('/home/user/old.txt')
    })

    it('should handle chained renames (A -> B -> C becomes A -> C)', async () => {
      coalescer = createEventCoalescer({ debounceMs: 50 })
      coalescer.onEmit(emitCallback)

      // Chained renames
      coalescer.add(createTestEvent('rename', '/b.txt', { oldPath: '/a.txt' }))
      coalescer.add(createTestEvent('rename', '/c.txt', { oldPath: '/b.txt' }))

      await vi.advanceTimersByTimeAsync(100)

      // Should coalesce to single rename from A to C
      expect(emittedEvents).toHaveLength(1)
      expect(emittedEvents[0]).toHaveLength(1)
      expect(emittedEvents[0][0].type).toBe('rename')
      expect(emittedEvents[0][0].path).toBe('/c.txt')
      expect(emittedEvents[0][0].oldPath).toBe('/a.txt')
    })

    it('should handle rename then delete as delete with oldPath', async () => {
      coalescer = createEventCoalescer({ debounceMs: 50 })
      coalescer.onEmit(emitCallback)

      // Rename then delete
      coalescer.add(createTestEvent('rename', '/new.txt', { oldPath: '/old.txt' }))
      coalescer.add(createTestEvent('delete', '/new.txt'))

      await vi.advanceTimersByTimeAsync(100)

      // Net effect: file at /old.txt is gone
      expect(emittedEvents).toHaveLength(1)
      expect(emittedEvents[0]).toHaveLength(1)
      expect(emittedEvents[0][0].type).toBe('delete')
      // Delete should reference the original path for watchers tracking that path
      expect(emittedEvents[0][0].path).toBe('/new.txt')
    })
  })

  describe('Events batched within window', () => {
    it('should batch events occurring within the same debounce window', async () => {
      coalescer = createEventCoalescer({ debounceMs: 50 })
      coalescer.onEmit(emitCallback)

      // Events for different files within same window
      coalescer.add(createTestEvent('create', '/home/user/file1.txt'))
      coalescer.add(createTestEvent('modify', '/home/user/file2.txt'))
      coalescer.add(createTestEvent('delete', '/home/user/file3.txt'))

      await vi.advanceTimersByTimeAsync(100)

      // All events should be emitted in a single batch
      expect(emittedEvents).toHaveLength(1)
      expect(emittedEvents[0]).toHaveLength(3)

      const types = emittedEvents[0].map((e) => e.type)
      expect(types).toContain('create')
      expect(types).toContain('modify')
      expect(types).toContain('delete')
    })

    it('should emit separate batches for events in different time windows', async () => {
      coalescer = createEventCoalescer({ debounceMs: 50 })
      coalescer.onEmit(emitCallback)

      // First window
      coalescer.add(createTestEvent('modify', '/file1.txt'))

      await vi.advanceTimersByTimeAsync(100)
      expect(emittedEvents).toHaveLength(1)

      // Second window (well after first)
      coalescer.add(createTestEvent('modify', '/file2.txt'))

      await vi.advanceTimersByTimeAsync(100)
      expect(emittedEvents).toHaveLength(2)
    })

    it('should respect maxBatchSize and emit early when reached', async () => {
      coalescer = createEventCoalescer({ debounceMs: 100, maxBatchSize: 3 })
      coalescer.onEmit(emitCallback)

      // Add events up to batch size
      coalescer.add(createTestEvent('modify', '/file1.txt'))
      coalescer.add(createTestEvent('modify', '/file2.txt'))
      coalescer.add(createTestEvent('modify', '/file3.txt'))

      // Should emit immediately upon reaching maxBatchSize
      await vi.advanceTimersByTimeAsync(1)
      expect(emittedEvents).toHaveLength(1)
      expect(emittedEvents[0]).toHaveLength(3)
    })

    it('should respect maxWaitMs and emit even with continuous events', async () => {
      coalescer = createEventCoalescer({ debounceMs: 50, maxWaitMs: 150 })
      coalescer.onEmit(emitCallback)

      // Add events continuously to keep resetting debounce
      coalescer.add(createTestEvent('modify', '/file.txt'))

      await vi.advanceTimersByTimeAsync(40)
      coalescer.add(createTestEvent('modify', '/file.txt'))

      await vi.advanceTimersByTimeAsync(40)
      coalescer.add(createTestEvent('modify', '/file.txt'))

      await vi.advanceTimersByTimeAsync(40)
      coalescer.add(createTestEvent('modify', '/file.txt'))

      // Still no emit (debounce keeps resetting)
      expect(emittedEvents).toHaveLength(0)

      // But at 150ms maxWait, should force emit
      await vi.advanceTimersByTimeAsync(40)
      expect(emittedEvents).toHaveLength(1)
    })
  })

  describe('Create followed by rapid modifies emits single create', () => {
    it('should emit create (not modify) when create is followed by modifies', async () => {
      coalescer = createEventCoalescer({ debounceMs: 50 })
      coalescer.onEmit(emitCallback)

      // Create followed by multiple modifies
      coalescer.add(createTestEvent('create', '/home/user/newfile.txt'))
      coalescer.add(createTestEvent('modify', '/home/user/newfile.txt'))
      coalescer.add(createTestEvent('modify', '/home/user/newfile.txt'))
      coalescer.add(createTestEvent('modify', '/home/user/newfile.txt'))

      await vi.advanceTimersByTimeAsync(100)

      // Should emit 'create' since that's the original/significant event
      expect(emittedEvents).toHaveLength(1)
      expect(emittedEvents[0]).toHaveLength(1)
      expect(emittedEvents[0][0].type).toBe('create')
      expect(emittedEvents[0][0].path).toBe('/home/user/newfile.txt')
    })

    it('should preserve the latest metadata when coalescing create + modify', async () => {
      coalescer = createEventCoalescer({ debounceMs: 50 })
      coalescer.onEmit(emitCallback)

      const createEvent: WatchEvent = {
        type: 'create',
        path: '/home/user/file.txt',
        timestamp: Date.now(),
        size: 100,
      }

      const modifyEvent: WatchEvent = {
        type: 'modify',
        path: '/home/user/file.txt',
        timestamp: Date.now() + 10,
        size: 500, // File grew after initial creation
        mtime: Date.now() + 10,
      }

      coalescer.add(createEvent)
      coalescer.add(modifyEvent)

      await vi.advanceTimersByTimeAsync(100)

      // Should emit create with latest size
      expect(emittedEvents).toHaveLength(1)
      expect(emittedEvents[0]).toHaveLength(1)
      expect(emittedEvents[0][0].type).toBe('create')
      expect(emittedEvents[0][0].size).toBe(500) // Latest size
    })
  })

  describe('Pending count tracking', () => {
    it('should track pending event count accurately', async () => {
      coalescer = createEventCoalescer({ debounceMs: 50 })
      coalescer.onEmit(emitCallback)

      expect(coalescer.getPendingCount()).toBe(0)

      coalescer.add(createTestEvent('modify', '/file1.txt'))
      expect(coalescer.getPendingCount()).toBe(1)

      coalescer.add(createTestEvent('modify', '/file2.txt'))
      expect(coalescer.getPendingCount()).toBe(2)

      // Same file shouldn't increase count
      coalescer.add(createTestEvent('modify', '/file1.txt'))
      expect(coalescer.getPendingCount()).toBe(2)

      await vi.advanceTimersByTimeAsync(100)
      expect(coalescer.getPendingCount()).toBe(0)
    })
  })

  describe('Flush functionality', () => {
    it('should immediately emit all pending events on flush', async () => {
      coalescer = createEventCoalescer({ debounceMs: 100 })
      coalescer.onEmit(emitCallback)

      coalescer.add(createTestEvent('modify', '/file1.txt'))
      coalescer.add(createTestEvent('modify', '/file2.txt'))

      expect(emittedEvents).toHaveLength(0)

      // Flush immediately
      coalescer.flush()

      await vi.advanceTimersByTimeAsync(1)
      expect(emittedEvents).toHaveLength(1)
      expect(emittedEvents[0]).toHaveLength(2)
    })

    it('should clear pending events after flush', async () => {
      coalescer = createEventCoalescer({ debounceMs: 100 })
      coalescer.onEmit(emitCallback)

      coalescer.add(createTestEvent('modify', '/file.txt'))
      expect(coalescer.getPendingCount()).toBe(1)

      coalescer.flush()
      await vi.advanceTimersByTimeAsync(1)

      expect(coalescer.getPendingCount()).toBe(0)
    })
  })

  describe('Dispose functionality', () => {
    it('should not emit events after dispose', async () => {
      coalescer = createEventCoalescer({ debounceMs: 50 })
      coalescer.onEmit(emitCallback)

      coalescer.add(createTestEvent('modify', '/file.txt'))

      // Dispose before debounce completes
      coalescer.dispose()

      await vi.advanceTimersByTimeAsync(100)

      // No events should have been emitted
      expect(emittedEvents).toHaveLength(0)
    })

    it('should clear all timers on dispose', async () => {
      coalescer = createEventCoalescer({ debounceMs: 50, maxWaitMs: 200 })
      coalescer.onEmit(emitCallback)

      coalescer.add(createTestEvent('modify', '/file1.txt'))
      coalescer.add(createTestEvent('modify', '/file2.txt'))
      coalescer.add(createTestEvent('modify', '/file3.txt'))

      coalescer.dispose()

      // Advance time well past all possible timers
      await vi.advanceTimersByTimeAsync(500)

      // Nothing should have been emitted
      expect(emittedEvents).toHaveLength(0)
    })
  })

  describe('Edge cases', () => {
    it('should handle empty path gracefully', async () => {
      coalescer = createEventCoalescer({ debounceMs: 50 })
      coalescer.onEmit(emitCallback)

      // Empty path - should be handled without throwing
      expect(() => coalescer.add(createTestEvent('modify', ''))).not.toThrow()
    })

    it('should handle root path events', async () => {
      coalescer = createEventCoalescer({ debounceMs: 50 })
      coalescer.onEmit(emitCallback)

      coalescer.add(createTestEvent('modify', '/'))

      await vi.advanceTimersByTimeAsync(100)

      expect(emittedEvents).toHaveLength(1)
      expect(emittedEvents[0][0].path).toBe('/')
    })

    it('should handle very long paths', async () => {
      coalescer = createEventCoalescer({ debounceMs: 50 })
      coalescer.onEmit(emitCallback)

      const longPath = '/home/user/' + 'deep/nested/'.repeat(50) + 'file.txt'
      coalescer.add(createTestEvent('modify', longPath))

      await vi.advanceTimersByTimeAsync(100)

      expect(emittedEvents).toHaveLength(1)
      expect(emittedEvents[0][0].path).toBe(longPath)
    })

    it('should handle special characters in paths', async () => {
      coalescer = createEventCoalescer({ debounceMs: 50 })
      coalescer.onEmit(emitCallback)

      const specialPath = '/home/user/my file (1).txt'
      coalescer.add(createTestEvent('modify', specialPath))

      await vi.advanceTimersByTimeAsync(100)

      expect(emittedEvents).toHaveLength(1)
      expect(emittedEvents[0][0].path).toBe(specialPath)
    })

    it('should handle unicode paths', async () => {
      coalescer = createEventCoalescer({ debounceMs: 50 })
      coalescer.onEmit(emitCallback)

      const unicodePath = '/home/user/documents/\u6587\u4EF6.txt' // 文件.txt
      coalescer.add(createTestEvent('modify', unicodePath))

      await vi.advanceTimersByTimeAsync(100)

      expect(emittedEvents).toHaveLength(1)
      expect(emittedEvents[0][0].path).toBe(unicodePath)
    })
  })
})

// ============================================================================
// Test Count Summary
// ============================================================================
// Total tests: 32
// - Multiple rapid writes coalesced to single event: 3
// - Configurable debounce interval: 4
// - Write then delete = single delete event: 3
// - Rename coalescing: 4
// - Events batched within window: 4
// - Create followed by rapid modifies emits single create: 2
// - Pending count tracking: 1
// - Flush functionality: 2
// - Dispose functionality: 2
// - Edge cases: 5
