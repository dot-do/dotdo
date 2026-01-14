/**
 * Tests for WatchManager timer cleanup on unwatch
 *
 * These tests verify that debounce timers are properly cleaned up when
 * watchers are removed, preventing memory leaks and orphaned timer callbacks.
 *
 * Test coverage:
 * - unwatch() clears associated debounce timer
 * - No timer fires after unwatch
 * - Memory stable after many watch/unwatch cycles
 * - Timer cleared even if Set still has callbacks
 * - maxWait timer cleared on unwatch
 *
 * @module test/watch/timer-cleanup.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { WatchManager, type WatchEntry } from '../../core/watch/manager.js'

/**
 * Helper to flush pending microtasks after advancing timers.
 * The WatchManager uses queueMicrotask for callback invocation.
 */
async function flushMicrotasks(): Promise<void> {
  await new Promise(resolve => queueMicrotask(resolve))
  await new Promise(resolve => queueMicrotask(resolve))
}

describe('WatchManager timer cleanup', () => {
  let manager: WatchManager

  beforeEach(() => {
    vi.useFakeTimers()
    manager = new WatchManager()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe('unwatch clears debounce timer', () => {
    it('should clear pending event timer when last watcher is removed', () => {
      // Arrange
      const listener = vi.fn()
      const watcher = manager.addWatcher('/home/user', false, listener)

      // Act - emit an event (starts debounce timer)
      manager.emit('change', '/home/user/file.txt')
      expect(manager.getPendingCount()).toBe(1)

      // Remove the watcher before debounce fires
      manager.removeWatcher(watcher)

      // Assert - pending event should be cleared
      expect(manager.getPendingCount()).toBe(0)

      // Advance time past debounce delay - callback should NOT fire
      vi.advanceTimersByTime(100)
      expect(listener).not.toHaveBeenCalled()
    })

    it('should NOT clear pending event timer when other watchers remain', async () => {
      // Arrange
      const listener1 = vi.fn()
      const listener2 = vi.fn()
      const watcher1 = manager.addWatcher('/home/user', false, listener1)
      const watcher2 = manager.addWatcher('/home/user', false, listener2)

      // Act - emit an event
      manager.emit('change', '/home/user/file.txt')
      expect(manager.getPendingCount()).toBe(1)

      // Remove one watcher
      manager.removeWatcher(watcher1)

      // Assert - pending event should still exist
      expect(manager.getPendingCount()).toBe(1)

      // Advance time - second listener should still fire
      vi.advanceTimersByTime(100)
      await flushMicrotasks()
      expect(listener1).not.toHaveBeenCalled() // closed watcher
      expect(listener2).toHaveBeenCalled() // remaining watcher
    })
  })

  describe('no timer fires after unwatch', () => {
    it('should not invoke callback after watcher is removed', () => {
      // Arrange
      const listener = vi.fn()
      const watcher = manager.addWatcher('/home/user', false, listener)

      // Emit event with short debounce
      manager.setDebounceDelay(50)
      manager.emit('change', '/home/user/file.txt')

      // Remove watcher before timer fires
      manager.removeWatcher(watcher)

      // Advance time past debounce
      vi.advanceTimersByTime(100)

      // Assert - listener should never be called
      expect(listener).not.toHaveBeenCalled()
    })

    it('should not invoke callback for recursive watcher after removal', () => {
      // Arrange
      const listener = vi.fn()
      const watcher = manager.addWatcher('/home', true, listener)

      // Emit event deep in hierarchy
      manager.emit('change', '/home/user/deep/nested/file.txt')

      // Remove watcher before timer fires
      manager.removeWatcher(watcher)

      // Advance time past debounce
      vi.advanceTimersByTime(100)

      // Assert
      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe('memory stability after watch/unwatch cycles', () => {
    it('should have zero pending events after many watch/unwatch cycles', () => {
      // Arrange
      manager.setDebounceDelay(100)

      // Act - perform many watch/unwatch cycles with events
      for (let i = 0; i < 100; i++) {
        const listener = vi.fn()
        const watcher = manager.addWatcher(`/path/${i}`, false, listener)
        manager.emit('change', `/path/${i}/file.txt`)
        manager.removeWatcher(watcher)
      }

      // Assert - no pending events should remain
      expect(manager.getPendingCount()).toBe(0)
      expect(manager.watcherCount).toBe(0)
    })

    it('should not accumulate timers across watch/unwatch cycles', () => {
      // This test verifies no timer references leak
      // Arrange
      manager.setDebounceDelay(1000) // Long debounce to ensure timers would stack

      const callCounts: number[] = []

      // Act - cycle watchers, each with pending events
      for (let i = 0; i < 50; i++) {
        const listener = vi.fn()
        const watcher = manager.addWatcher('/shared/path', false, listener)
        manager.emit('change', '/shared/path/file.txt')
        manager.removeWatcher(watcher)
        callCounts.push(listener.mock.calls.length)
      }

      // Advance time far past all debounce windows
      vi.advanceTimersByTime(10000)

      // Assert - no lingering callbacks fired
      for (let i = 0; i < callCounts.length; i++) {
        expect(callCounts[i]).toBe(0)
      }
      expect(manager.getPendingCount()).toBe(0)
    })
  })

  describe('timer cleared even if Set still has callbacks', () => {
    it('should clear path timer when removing last watcher for that path', async () => {
      // Arrange - set up watchers on different paths
      const listener1 = vi.fn()
      const listener2 = vi.fn()
      const watcher1 = manager.addWatcher('/path/a', false, listener1)
      const watcher2 = manager.addWatcher('/path/b', false, listener2)

      // Emit events on both paths
      manager.emit('change', '/path/a/file.txt')
      manager.emit('change', '/path/b/file.txt')
      expect(manager.getPendingCount()).toBe(2)

      // Remove watcher for path/a
      manager.removeWatcher(watcher1)

      // Assert - only path/b pending event remains
      expect(manager.getPendingCount()).toBe(1)

      // Advance time - only listener2 should fire
      vi.advanceTimersByTime(100)
      await flushMicrotasks()
      expect(listener1).not.toHaveBeenCalled()
      expect(listener2).toHaveBeenCalled()
    })

    it('should handle parent/child path watchers correctly', async () => {
      // Arrange - parent and child path watchers
      const parentListener = vi.fn()
      const childListener = vi.fn()
      const parentWatcher = manager.addWatcher('/home', true, parentListener)
      const childWatcher = manager.addWatcher('/home/user', false, childListener)

      // Emit event in child directory
      manager.emit('change', '/home/user/file.txt')

      // Remove parent watcher (child should still receive event)
      manager.removeWatcher(parentWatcher)

      // Advance time
      vi.advanceTimersByTime(100)
      await flushMicrotasks()

      // Assert - child listener should fire, parent should not
      expect(parentListener).not.toHaveBeenCalled()
      expect(childListener).toHaveBeenCalled()
    })
  })

  describe('maxWait timer cleanup', () => {
    it('should clear maxWait timer when watcher is removed', async () => {
      // Arrange
      const listener = vi.fn()
      manager.setDebounceDelay(100)
      manager.setMaxWait(500) // Force emit after 500ms regardless of debounce

      const watcher = manager.addWatcher('/home/user', false, listener)

      // Emit event - starts both debounce and maxWait timers
      manager.emit('change', '/home/user/file.txt')

      // Remove watcher before maxWait fires
      manager.removeWatcher(watcher)

      // Advance time past maxWait
      vi.advanceTimersByTime(1000)
      await flushMicrotasks()

      // Assert - neither timer should have fired callback
      expect(listener).not.toHaveBeenCalled()
    })

    it('should clear maxWaitTimer resource when last watcher is removed (BUG: timer leak)', () => {
      // This test exposes the bug where maxWaitTimer is not cleared in cleanup
      // Arrange
      const listener = vi.fn()
      manager.setDebounceDelay(100)
      manager.setMaxWait(500)

      const watcher = manager.addWatcher('/home/user', false, listener)

      // Emit event - starts both debounce timer and maxWait timer
      manager.emit('change', '/home/user/file.txt')
      expect(manager.getPendingCount()).toBe(1)

      // Remove watcher - should clear BOTH timers
      manager.removeWatcher(watcher)

      // Assert - pending events cleared
      expect(manager.getPendingCount()).toBe(0)

      // The key test: after removal, no timers should be active
      // vi.getTimerCount() returns count of pending timers
      // If maxWaitTimer wasn't cleared, there will be 1 orphaned timer
      expect(vi.getTimerCount()).toBe(0)
    })

    it('should clear maxWait timer for specific path only', async () => {
      // Arrange
      const listener1 = vi.fn()
      const listener2 = vi.fn()
      manager.setDebounceDelay(100)
      manager.setPathMaxWait('/path/a', 500)
      manager.setPathMaxWait('/path/b', 500)

      const watcher1 = manager.addWatcher('/path/a', false, listener1)
      const watcher2 = manager.addWatcher('/path/b', false, listener2)

      // Emit events on both paths
      manager.emit('change', '/path/a/file.txt')
      manager.emit('change', '/path/b/file.txt')

      // Keep resetting debounce for path/b
      for (let i = 0; i < 10; i++) {
        vi.advanceTimersByTime(50)
        manager.emit('change', '/path/b/file.txt')
      }

      // Remove watcher1
      manager.removeWatcher(watcher1)

      // Advance past maxWait
      vi.advanceTimersByTime(600)
      await flushMicrotasks()

      // Assert - listener1 should not fire (watcher removed)
      // listener2 should fire (maxWait triggered)
      expect(listener1).not.toHaveBeenCalled()
      expect(listener2).toHaveBeenCalled()
    })
  })

  describe('edge cases', () => {
    it('should handle removing already-closed watcher gracefully', () => {
      // Arrange
      const listener = vi.fn()
      const watcher = manager.addWatcher('/home/user', false, listener)
      manager.emit('change', '/home/user/file.txt')

      // Remove twice
      manager.removeWatcher(watcher)
      expect(() => manager.removeWatcher(watcher)).not.toThrow()

      vi.advanceTimersByTime(100)
      expect(listener).not.toHaveBeenCalled()
    })

    it('should handle rapid add/emit/remove sequences', () => {
      // Arrange
      const listeners: ReturnType<typeof vi.fn>[] = []

      // Act - rapid fire
      for (let i = 0; i < 10; i++) {
        const listener = vi.fn()
        listeners.push(listener)
        const watcher = manager.addWatcher('/rapid', false, listener)
        manager.emit('change', '/rapid/file.txt')
        manager.removeWatcher(watcher)
      }

      // Advance time
      vi.advanceTimersByTime(1000)

      // Assert - no listeners should have fired
      for (const listener of listeners) {
        expect(listener).not.toHaveBeenCalled()
      }
      expect(manager.getPendingCount()).toBe(0)
    })

    it('should clean up timer when file path watcher is removed', () => {
      // Arrange - watch specific file, not directory
      const listener = vi.fn()
      const watcher = manager.addWatcher('/home/user/file.txt', false, listener)

      // Emit event for that exact file
      manager.emit('change', '/home/user/file.txt')
      expect(manager.getPendingCount()).toBe(1)

      // Remove watcher
      manager.removeWatcher(watcher)

      // Assert
      expect(manager.getPendingCount()).toBe(0)
      vi.advanceTimersByTime(100)
      expect(listener).not.toHaveBeenCalled()
    })
  })
})
