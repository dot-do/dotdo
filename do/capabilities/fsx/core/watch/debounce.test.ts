/**
 * Tests for debouncing rapid file changes in the WatchManager
 *
 * TDD RED phase tests - these tests specify the debounce behavior:
 * - Multiple rapid writes to same file emit single event
 * - Events from different files are not coalesced
 * - Debounce window is configurable
 * - Final event reflects latest state
 * - Create followed by rapid modifies emits single create
 * - Modify followed by delete emits only delete
 * - Timeout triggers event emission
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// We'll import the WatchManager with debounce support once implemented
// For now, we define the expected interface
interface DebouncedWatchManager {
  addWatcher(
    path: string,
    recursive: boolean,
    listener: (eventType: string, filename: string) => void
  ): { id: number; closed: boolean }
  removeWatcher(entry: { id: number; closed: boolean }): void
  emit(eventType: 'change' | 'rename', affectedPath: string): void
  setDebounceDelay(ms: number): void
  getDebounceDelay(): number
  flushPending(): void
  getPendingCount(): number
}

// Import from the actual implementation
import { WatchManager } from './manager'

describe('WatchManager debounce', () => {
  let manager: WatchManager
  let listener: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    manager = new WatchManager()
    listener = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('Multiple rapid writes to same file emit single event', () => {
    it('should emit only one event for rapid sequential writes to the same file', async () => {
      const entry = manager.addWatcher('/home/user', false, listener)

      // Emit 5 rapid change events for the same file
      manager.emit('change', '/home/user/file.txt')
      manager.emit('change', '/home/user/file.txt')
      manager.emit('change', '/home/user/file.txt')
      manager.emit('change', '/home/user/file.txt')
      manager.emit('change', '/home/user/file.txt')

      // Before debounce delay expires, no events should have been emitted
      await vi.advanceTimersByTimeAsync(10)
      expect(listener).not.toHaveBeenCalled()

      // After debounce delay, exactly one event should be emitted
      await vi.advanceTimersByTimeAsync(100)
      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith('change', 'file.txt')

      manager.removeWatcher(entry)
    })

    it('should reset the debounce timer on each new event', async () => {
      const entry = manager.addWatcher('/home/user', false, listener)

      // Emit an event
      manager.emit('change', '/home/user/file.txt')

      // Wait 40ms, then emit another event (should reset timer)
      await vi.advanceTimersByTimeAsync(40)
      manager.emit('change', '/home/user/file.txt')

      // At 80ms total (40ms after second event), still no emission
      await vi.advanceTimersByTimeAsync(40)
      expect(listener).not.toHaveBeenCalled()

      // At 110ms total (70ms after second event, past default 50ms delay)
      await vi.advanceTimersByTimeAsync(30)
      expect(listener).toHaveBeenCalledTimes(1)

      manager.removeWatcher(entry)
    })
  })

  describe('Events from different files are not coalesced', () => {
    it('should emit separate events for different files', async () => {
      const entry = manager.addWatcher('/home/user', false, listener)

      // Emit events for different files
      manager.emit('change', '/home/user/file1.txt')
      manager.emit('change', '/home/user/file2.txt')
      manager.emit('change', '/home/user/file3.txt')

      // After debounce delay, three separate events should be emitted
      await vi.advanceTimersByTimeAsync(100)

      expect(listener).toHaveBeenCalledTimes(3)
      expect(listener).toHaveBeenCalledWith('change', 'file1.txt')
      expect(listener).toHaveBeenCalledWith('change', 'file2.txt')
      expect(listener).toHaveBeenCalledWith('change', 'file3.txt')

      manager.removeWatcher(entry)
    })

    it('should coalesce same file but not different files in rapid succession', async () => {
      const entry = manager.addWatcher('/home/user', false, listener)

      // Rapid events: file1 x3, file2 x2
      manager.emit('change', '/home/user/file1.txt')
      manager.emit('change', '/home/user/file1.txt')
      manager.emit('change', '/home/user/file2.txt')
      manager.emit('change', '/home/user/file1.txt')
      manager.emit('change', '/home/user/file2.txt')

      // After debounce delay
      await vi.advanceTimersByTimeAsync(100)

      // Should have exactly 2 events (one per file)
      expect(listener).toHaveBeenCalledTimes(2)
      expect(listener).toHaveBeenCalledWith('change', 'file1.txt')
      expect(listener).toHaveBeenCalledWith('change', 'file2.txt')

      manager.removeWatcher(entry)
    })
  })

  describe('Debounce window is configurable', () => {
    it('should respect custom debounce delay', async () => {
      manager.setDebounceDelay(200) // Set to 200ms
      const entry = manager.addWatcher('/home/user', false, listener)

      manager.emit('change', '/home/user/file.txt')

      // At 100ms, no event yet (default would have fired)
      await vi.advanceTimersByTimeAsync(100)
      expect(listener).not.toHaveBeenCalled()

      // At 200ms+, event should fire
      await vi.advanceTimersByTimeAsync(150)
      expect(listener).toHaveBeenCalledTimes(1)

      manager.removeWatcher(entry)
    })

    it('should get the current debounce delay', () => {
      expect(manager.getDebounceDelay()).toBe(50) // Default value

      manager.setDebounceDelay(100)
      expect(manager.getDebounceDelay()).toBe(100)
    })

    it('should support zero delay (immediate emission)', async () => {
      manager.setDebounceDelay(0)
      const entry = manager.addWatcher('/home/user', false, listener)

      manager.emit('change', '/home/user/file.txt')

      // With zero delay, event should fire on next tick
      await vi.advanceTimersByTimeAsync(1)
      expect(listener).toHaveBeenCalledTimes(1)

      manager.removeWatcher(entry)
    })
  })

  describe('Final event reflects latest state', () => {
    it('should use the latest event type when coalescing', async () => {
      const entry = manager.addWatcher('/home/user', false, listener)

      // Multiple rapid changes of different types to the same file
      manager.emit('change', '/home/user/file.txt')
      manager.emit('change', '/home/user/file.txt')

      // After debounce delay
      await vi.advanceTimersByTimeAsync(100)

      // Should emit the latest event type
      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith('change', 'file.txt')

      manager.removeWatcher(entry)
    })
  })

  describe('Smart coalescing: create + modify = create', () => {
    it('should emit create (not change) when create is followed by modifies', async () => {
      const entry = manager.addWatcher('/home/user', false, listener)

      // Create followed by multiple modifies
      manager.emit('rename', '/home/user/newfile.txt') // rename = create in fs.watch
      manager.emit('change', '/home/user/newfile.txt')
      manager.emit('change', '/home/user/newfile.txt')

      // After debounce delay
      await vi.advanceTimersByTimeAsync(100)

      // Should emit 'rename' (create) since that was the original event
      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith('rename', 'newfile.txt')

      manager.removeWatcher(entry)
    })
  })

  describe('Smart coalescing: modify + delete = delete', () => {
    it('should emit delete (rename) when modifies are followed by delete', async () => {
      const entry = manager.addWatcher('/home/user', false, listener)

      // Multiple modifies followed by delete
      manager.emit('change', '/home/user/file.txt')
      manager.emit('change', '/home/user/file.txt')
      manager.emit('rename', '/home/user/file.txt') // rename = delete in this context

      // After debounce delay
      await vi.advanceTimersByTimeAsync(100)

      // Should emit 'rename' (delete) since that was the final operation
      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith('rename', 'file.txt')

      manager.removeWatcher(entry)
    })
  })

  describe('Timeout triggers event emission', () => {
    it('should emit event after debounce timeout', async () => {
      const entry = manager.addWatcher('/home/user', false, listener)

      manager.emit('change', '/home/user/file.txt')

      // No emission before timeout
      expect(listener).not.toHaveBeenCalled()

      // Advance past debounce delay
      await vi.advanceTimersByTimeAsync(100)

      // Event should be emitted
      expect(listener).toHaveBeenCalledTimes(1)

      manager.removeWatcher(entry)
    })

    it('should not emit events after watcher is closed', async () => {
      const entry = manager.addWatcher('/home/user', false, listener)

      manager.emit('change', '/home/user/file.txt')

      // Close the watcher before timeout
      manager.removeWatcher(entry)

      // Advance past debounce delay
      await vi.advanceTimersByTimeAsync(100)

      // No event should be emitted
      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe('Flush pending events', () => {
    it('should immediately emit all pending events on flush', async () => {
      const entry = manager.addWatcher('/home/user', false, listener)

      // Queue up some events
      manager.emit('change', '/home/user/file1.txt')
      manager.emit('change', '/home/user/file2.txt')

      // Events should not have fired yet
      expect(listener).not.toHaveBeenCalled()

      // Flush all pending events
      manager.flushPending()

      // Allow microtasks to run
      await vi.advanceTimersByTimeAsync(1)

      // Both events should now be emitted
      expect(listener).toHaveBeenCalledTimes(2)

      manager.removeWatcher(entry)
    })

    it('should report pending event count', () => {
      const entry = manager.addWatcher('/home/user', false, listener)

      expect(manager.getPendingCount()).toBe(0)

      manager.emit('change', '/home/user/file1.txt')
      expect(manager.getPendingCount()).toBe(1)

      manager.emit('change', '/home/user/file2.txt')
      expect(manager.getPendingCount()).toBe(2)

      // Same file doesn't increase count
      manager.emit('change', '/home/user/file1.txt')
      expect(manager.getPendingCount()).toBe(2)

      manager.removeWatcher(entry)
    })
  })

  describe('Cleanup on watcher removal', () => {
    it('should clear pending events for a path when last watcher is removed', async () => {
      const entry = manager.addWatcher('/home/user', false, listener)

      manager.emit('change', '/home/user/file.txt')
      expect(manager.getPendingCount()).toBeGreaterThan(0)

      manager.removeWatcher(entry)

      // Pending events should be cleared (or at least not delivered)
      await vi.advanceTimersByTimeAsync(100)
      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe('Per-path debounce configuration', () => {
    it('should allow setting debounce delay for specific paths', async () => {
      // Set faster debounce for logs directory
      manager.setPathDebounceDelay('/logs', 10)
      // Set slower debounce for assets
      manager.setPathDebounceDelay('/assets', 200)

      const logsListener = vi.fn()
      const assetsListener = vi.fn()

      const logsEntry = manager.addWatcher('/logs', false, logsListener)
      const assetsEntry = manager.addWatcher('/assets', false, assetsListener)

      manager.emit('change', '/logs/app.log')
      manager.emit('change', '/assets/image.png')

      // After 20ms, logs should emit but assets shouldn't
      await vi.advanceTimersByTimeAsync(20)
      expect(logsListener).toHaveBeenCalledTimes(1)
      expect(assetsListener).not.toHaveBeenCalled()

      // After 250ms total, assets should also emit
      await vi.advanceTimersByTimeAsync(230)
      expect(assetsListener).toHaveBeenCalledTimes(1)

      manager.removeWatcher(logsEntry)
      manager.removeWatcher(assetsEntry)
    })

    it('should fall back to global debounce delay for unconfigured paths', async () => {
      manager.setDebounceDelay(100) // Global default
      manager.setPathDebounceDelay('/special', 10) // Only /special has custom delay

      const specialListener = vi.fn()
      const normalListener = vi.fn()

      const specialEntry = manager.addWatcher('/special', false, specialListener)
      const normalEntry = manager.addWatcher('/normal', false, normalListener)

      manager.emit('change', '/special/file.txt')
      manager.emit('change', '/normal/file.txt')

      // After 20ms, only special should emit (10ms delay)
      await vi.advanceTimersByTimeAsync(20)
      expect(specialListener).toHaveBeenCalledTimes(1)
      expect(normalListener).not.toHaveBeenCalled()

      // After 120ms total, normal should emit (100ms global delay)
      await vi.advanceTimersByTimeAsync(100)
      expect(normalListener).toHaveBeenCalledTimes(1)

      manager.removeWatcher(specialEntry)
      manager.removeWatcher(normalEntry)
    })

    it('should get path-specific debounce delay', () => {
      manager.setDebounceDelay(50) // Global default
      manager.setPathDebounceDelay('/fast', 10)

      expect(manager.getPathDebounceDelay('/fast')).toBe(10)
      expect(manager.getPathDebounceDelay('/other')).toBe(50) // Falls back to global
    })

    it('should clear path-specific debounce delay', () => {
      manager.setDebounceDelay(50)
      manager.setPathDebounceDelay('/custom', 100)

      expect(manager.getPathDebounceDelay('/custom')).toBe(100)

      manager.clearPathDebounceDelay('/custom')

      expect(manager.getPathDebounceDelay('/custom')).toBe(50) // Falls back to global
    })

    it('should support glob patterns for path configuration', async () => {
      manager.setPathDebounceDelay('*.log', 10) // All .log files get fast debounce

      const logListener = vi.fn()
      const txtListener = vi.fn()

      const logsEntry = manager.addWatcher('/var/log', false, logListener)
      const docsEntry = manager.addWatcher('/var/log', false, txtListener)

      manager.emit('change', '/var/log/app.log')
      manager.emit('change', '/var/log/readme.txt')

      // Log file should emit after 20ms (10ms delay)
      await vi.advanceTimersByTimeAsync(20)
      // Check that .log file got faster debounce
      expect(logListener).toHaveBeenCalled()

      manager.removeWatcher(logsEntry)
      manager.removeWatcher(docsEntry)
    })
  })

  describe('Leading edge debounce', () => {
    it('should emit immediately on first event when leading mode is enabled', async () => {
      manager.setDebounceMode('leading')
      const entry = manager.addWatcher('/home/user', false, listener)

      manager.emit('change', '/home/user/file.txt')

      // With leading mode, event should fire immediately on first event
      await vi.advanceTimersByTimeAsync(1)
      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith('change', 'file.txt')

      // Subsequent rapid events should be debounced
      manager.emit('change', '/home/user/file.txt')
      manager.emit('change', '/home/user/file.txt')

      await vi.advanceTimersByTimeAsync(1)
      expect(listener).toHaveBeenCalledTimes(1) // Still just 1 call

      // After debounce period, next event should emit immediately again
      await vi.advanceTimersByTimeAsync(100)
      manager.emit('change', '/home/user/file.txt')
      await vi.advanceTimersByTimeAsync(1)
      expect(listener).toHaveBeenCalledTimes(2)

      manager.removeWatcher(entry)
    })

    it('should support both leading and trailing mode', async () => {
      manager.setDebounceMode('both')
      const entry = manager.addWatcher('/home/user', false, listener)

      // First event emits immediately (leading)
      manager.emit('change', '/home/user/file.txt')
      await vi.advanceTimersByTimeAsync(1)
      expect(listener).toHaveBeenCalledTimes(1)

      // More events within debounce window
      manager.emit('change', '/home/user/file.txt')
      manager.emit('change', '/home/user/file.txt')

      // After debounce period, trailing event emits
      await vi.advanceTimersByTimeAsync(100)
      expect(listener).toHaveBeenCalledTimes(2) // Leading + trailing

      manager.removeWatcher(entry)
    })

    it('should get and set debounce mode', () => {
      expect(manager.getDebounceMode()).toBe('trailing') // Default

      manager.setDebounceMode('leading')
      expect(manager.getDebounceMode()).toBe('leading')

      manager.setDebounceMode('both')
      expect(manager.getDebounceMode()).toBe('both')

      manager.setDebounceMode('trailing')
      expect(manager.getDebounceMode()).toBe('trailing')
    })
  })

  describe('Max wait time', () => {
    it('should force emit after max wait time even if debounce keeps resetting', async () => {
      manager.setDebounceDelay(50)
      manager.setMaxWait(150) // Force emit after 150ms even with constant events

      const entry = manager.addWatcher('/home/user', false, listener)

      // Emit events every 30ms, which would normally keep resetting the 50ms debounce
      manager.emit('change', '/home/user/file.txt')

      await vi.advanceTimersByTimeAsync(30)
      manager.emit('change', '/home/user/file.txt')
      expect(listener).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(30)
      manager.emit('change', '/home/user/file.txt')
      expect(listener).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(30)
      manager.emit('change', '/home/user/file.txt')
      expect(listener).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(30)
      manager.emit('change', '/home/user/file.txt')
      expect(listener).not.toHaveBeenCalled()

      // At 150ms, max wait should force emit
      await vi.advanceTimersByTimeAsync(30)
      expect(listener).toHaveBeenCalledTimes(1)

      manager.removeWatcher(entry)
    })

    it('should emit normally if max wait is not reached', async () => {
      manager.setDebounceDelay(50)
      manager.setMaxWait(500) // High max wait

      const entry = manager.addWatcher('/home/user', false, listener)

      manager.emit('change', '/home/user/file.txt')

      // Normal debounce should emit at 50ms, not waiting for 500ms max
      await vi.advanceTimersByTimeAsync(60)
      expect(listener).toHaveBeenCalledTimes(1)

      manager.removeWatcher(entry)
    })

    it('should get and set max wait time', () => {
      expect(manager.getMaxWait()).toBeUndefined() // Disabled by default

      manager.setMaxWait(200)
      expect(manager.getMaxWait()).toBe(200)

      manager.setMaxWait(undefined) // Disable
      expect(manager.getMaxWait()).toBeUndefined()
    })

    it('should work with per-path max wait', async () => {
      manager.setDebounceDelay(50)
      manager.setPathMaxWait('/critical', 100)

      const criticalListener = vi.fn()
      const normalListener = vi.fn()

      const criticalEntry = manager.addWatcher('/critical', false, criticalListener)
      const normalEntry = manager.addWatcher('/normal', false, normalListener)

      // Both start with events
      manager.emit('change', '/critical/file.txt')
      manager.emit('change', '/normal/file.txt')

      // Keep emitting to prevent normal debounce from firing
      await vi.advanceTimersByTimeAsync(40)
      manager.emit('change', '/critical/file.txt')
      manager.emit('change', '/normal/file.txt')

      await vi.advanceTimersByTimeAsync(40)
      manager.emit('change', '/critical/file.txt')
      manager.emit('change', '/normal/file.txt')

      // At 80ms + a bit more, critical should force emit due to 100ms max wait
      await vi.advanceTimersByTimeAsync(30)
      expect(criticalListener).toHaveBeenCalledTimes(1)
      expect(normalListener).not.toHaveBeenCalled() // No max wait set

      // Let normal debounce complete
      await vi.advanceTimersByTimeAsync(60)
      expect(normalListener).toHaveBeenCalledTimes(1)

      manager.removeWatcher(criticalEntry)
      manager.removeWatcher(normalEntry)
    })
  })

  describe('Smart coalescing configuration', () => {
    it('should allow disabling smart coalescing', async () => {
      manager.setSmartCoalescing(false)
      const entry = manager.addWatcher('/home/user', false, listener)

      // Without smart coalescing, last event type wins
      manager.emit('rename', '/home/user/file.txt') // Create
      manager.emit('change', '/home/user/file.txt') // Modify

      await vi.advanceTimersByTimeAsync(100)

      // Without smart coalescing, should emit 'change' (last event)
      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith('change', 'file.txt')

      manager.removeWatcher(entry)
    })

    it('should get and set smart coalescing', () => {
      expect(manager.isSmartCoalescing()).toBe(true) // Default enabled

      manager.setSmartCoalescing(false)
      expect(manager.isSmartCoalescing()).toBe(false)

      manager.setSmartCoalescing(true)
      expect(manager.isSmartCoalescing()).toBe(true)
    })
  })
})
