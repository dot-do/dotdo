/**
 * Tests for TimerWindowManager - Timer operations backed by WindowManager
 *
 * TDD RED Phase: These tests define the expected behavior for timer management
 * using WindowManager primitives instead of raw setTimeout.
 *
 * Use Cases:
 * 1. sleep() - Tumbling window of 1 element
 * 2. Workflow Execution Timeout - Global window with deadline
 * 3. Activity Heartbeat Timeout - Session window with gap
 * 4. Schedule-to-Close Timeout - Window with start/end
 *
 * Run tests: npx vitest run workflows/compat/temporal/timer-window-manager.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  TimerWindowManager,
  createTimerWindowManager,
  type TimerConfig,
  type HeartbeatConfig,
  type DeadlineConfig,
  type TimerWindowHandle,
} from './timer-window-manager'
import { milliseconds, seconds, minutes } from '../../../db/primitives/window-manager'

// ============================================================================
// Basic Timer Operations (sleep equivalent)
// ============================================================================

describe('TimerWindowManager - Basic Timer Operations', () => {
  let manager: TimerWindowManager

  beforeEach(() => {
    manager = createTimerWindowManager()
  })

  afterEach(() => {
    manager.dispose()
  })

  describe('createTimer()', () => {
    it('should create a timer that resolves after duration', async () => {
      const start = Date.now()
      const handle = manager.createTimer({ duration: milliseconds(50) })

      await handle.promise

      const elapsed = Date.now() - start
      expect(elapsed).toBeGreaterThanOrEqual(45)
    })

    it('should return a handle with timerId', async () => {
      const handle = manager.createTimer({ duration: milliseconds(100) })

      expect(handle.timerId).toBeDefined()
      expect(typeof handle.timerId).toBe('string')

      handle.cancel()
      await handle.promise.catch(() => {}) // Catch cancellation rejection
    })

    it('should generate unique timer IDs', async () => {
      const handle1 = manager.createTimer({ duration: milliseconds(100) })
      const handle2 = manager.createTimer({ duration: milliseconds(100) })

      expect(handle1.timerId).not.toBe(handle2.timerId)

      handle1.cancel()
      handle2.cancel()
      await handle1.promise.catch(() => {}) // Catch cancellation rejection
      await handle2.promise.catch(() => {}) // Catch cancellation rejection
    })

    it('should support custom timer ID', async () => {
      const handle = manager.createTimer({
        duration: milliseconds(100),
        timerId: 'custom-timer-id',
      })

      expect(handle.timerId).toBe('custom-timer-id')

      handle.cancel()
      await handle.promise.catch(() => {}) // Catch cancellation rejection
    })

    it('should track pending state', async () => {
      const handle = manager.createTimer({ duration: milliseconds(50) })

      expect(handle.pending).toBe(true)

      await handle.promise

      expect(handle.pending).toBe(false)
    })
  })

  describe('cancel()', () => {
    it('should cancel a pending timer', async () => {
      const handle = manager.createTimer({ duration: seconds(10) })

      const cancelled = handle.cancel()

      expect(cancelled).toBe(true)
      expect(handle.pending).toBe(false)
      await handle.promise.catch(() => {}) // Catch cancellation rejection
    })

    it('should reject the timer promise on cancellation', async () => {
      const handle = manager.createTimer({ duration: seconds(10) })

      handle.cancel()

      await expect(handle.promise).rejects.toThrow(/cancelled/i)
    })

    it('should return false when cancelling already completed timer', async () => {
      const handle = manager.createTimer({ duration: milliseconds(10) })

      await handle.promise

      const cancelled = handle.cancel()

      expect(cancelled).toBe(false)
    })

    it('should return false when cancelling already cancelled timer', async () => {
      const handle = manager.createTimer({ duration: seconds(10) })

      handle.cancel()
      const secondCancel = handle.cancel()

      expect(secondCancel).toBe(false)
      await handle.promise.catch(() => {}) // Catch cancellation rejection
    })
  })

  describe('sleep()', () => {
    it('should sleep for the specified duration', async () => {
      const start = Date.now()

      await manager.sleep(milliseconds(50))

      const elapsed = Date.now() - start
      expect(elapsed).toBeGreaterThanOrEqual(45)
    })

    it('should support string duration format', async () => {
      const start = Date.now()

      await manager.sleep('50ms')

      const elapsed = Date.now() - start
      expect(elapsed).toBeGreaterThanOrEqual(45)
    })

    it('should support numeric duration (milliseconds)', async () => {
      const start = Date.now()

      await manager.sleep(50)

      const elapsed = Date.now() - start
      expect(elapsed).toBeGreaterThanOrEqual(45)
    })
  })
})

// ============================================================================
// Timer Coalescing (Optimization)
// ============================================================================

describe('TimerWindowManager - Timer Coalescing', () => {
  let manager: TimerWindowManager

  beforeEach(() => {
    vi.useFakeTimers()
    manager = createTimerWindowManager({
      coalesceWindow: milliseconds(10),
    })
  })

  afterEach(() => {
    manager.dispose()
    vi.useRealTimers()
  })

  it('should coalesce timers firing within the same window', async () => {
    const timers = [
      manager.createTimer({ duration: milliseconds(100) }),
      manager.createTimer({ duration: milliseconds(102) }),
      manager.createTimer({ duration: milliseconds(105) }),
    ]

    // All 3 timers should be coalesced into same bucket
    expect(manager.getCoalescedBucketCount()).toBe(1)

    // Clean up
    timers.forEach(t => t.cancel())
    await Promise.all(timers.map(t => t.promise.catch(() => {}))) // Catch cancellation rejections
  })

  it('should keep timers in separate buckets when beyond coalesce window', async () => {
    const timer1 = manager.createTimer({ duration: milliseconds(100) })
    const timer2 = manager.createTimer({ duration: milliseconds(150) }) // Beyond 10ms window

    expect(manager.getCoalescedBucketCount()).toBe(2)

    timer1.cancel()
    timer2.cancel()
    await timer1.promise.catch(() => {}) // Catch cancellation rejection
    await timer2.promise.catch(() => {}) // Catch cancellation rejection
  })

  it('should fire all coalesced timers together', async () => {
    const resolved: string[] = []

    const timer1 = manager.createTimer({ duration: milliseconds(100), timerId: 't1' })
    const timer2 = manager.createTimer({ duration: milliseconds(105), timerId: 't2' })

    timer1.promise.then(() => resolved.push('t1'))
    timer2.promise.then(() => resolved.push('t2'))

    vi.advanceTimersByTime(110)
    await Promise.resolve() // Flush microtasks
    await Promise.resolve()

    expect(resolved).toHaveLength(2)
    expect(resolved).toContain('t1')
    expect(resolved).toContain('t2')
  })

  it('should remove coalesced bucket when all timers are cancelled', async () => {
    const timer1 = manager.createTimer({ duration: milliseconds(100) })
    const timer2 = manager.createTimer({ duration: milliseconds(105) })

    expect(manager.getCoalescedBucketCount()).toBe(1)

    timer1.cancel()
    timer2.cancel()

    expect(manager.getCoalescedBucketCount()).toBe(0)
    await timer1.promise.catch(() => {}) // Catch cancellation rejection
    await timer2.promise.catch(() => {}) // Catch cancellation rejection
  })

  it('should preserve bucket when only some timers are cancelled', async () => {
    const timer1 = manager.createTimer({ duration: milliseconds(100) })
    const timer2 = manager.createTimer({ duration: milliseconds(105) })

    expect(manager.getCoalescedBucketCount()).toBe(1)

    timer1.cancel()
    await timer1.promise.catch(() => {}) // Catch cancellation rejection

    expect(manager.getCoalescedBucketCount()).toBe(1)

    timer2.cancel()
    await timer2.promise.catch(() => {}) // Catch cancellation rejection
  })
})

// ============================================================================
// Workflow Execution Timeout (Global Window with Deadline)
// ============================================================================

describe('TimerWindowManager - Workflow Execution Timeout', () => {
  let manager: TimerWindowManager

  beforeEach(() => {
    vi.useFakeTimers()
    manager = createTimerWindowManager()
  })

  afterEach(() => {
    manager.dispose()
    vi.useRealTimers()
  })

  describe('setWorkflowTimeout()', () => {
    it('should create a global deadline for workflow execution', () => {
      manager.setWorkflowTimeout({
        workflowId: 'wf-1',
        timeout: minutes(30),
      })

      expect(manager.hasWorkflowTimeout('wf-1')).toBe(true)
    })

    it('should fire callback when workflow timeout is exceeded', async () => {
      let timedOut = false

      manager.setWorkflowTimeout({
        workflowId: 'wf-2',
        timeout: milliseconds(100),
        onTimeout: () => {
          timedOut = true
        },
      })

      vi.advanceTimersByTime(150)
      await Promise.resolve()

      expect(timedOut).toBe(true)
    })

    it('should clear workflow timeout', () => {
      manager.setWorkflowTimeout({
        workflowId: 'wf-3',
        timeout: minutes(30),
      })

      manager.clearWorkflowTimeout('wf-3')

      expect(manager.hasWorkflowTimeout('wf-3')).toBe(false)
    })

    it('should not fire callback after timeout is cleared', async () => {
      let timedOut = false

      manager.setWorkflowTimeout({
        workflowId: 'wf-4',
        timeout: milliseconds(100),
        onTimeout: () => {
          timedOut = true
        },
      })

      manager.clearWorkflowTimeout('wf-4')

      vi.advanceTimersByTime(150)
      await Promise.resolve()

      expect(timedOut).toBe(false)
    })

    it('should return remaining time until workflow timeout', () => {
      manager.setWorkflowTimeout({
        workflowId: 'wf-5',
        timeout: milliseconds(1000),
      })

      // Use manager.advanceTime() to update currentTime for remaining calculations
      manager.advanceTime(300)

      const remaining = manager.getWorkflowTimeoutRemaining('wf-5')

      expect(remaining).toBeGreaterThanOrEqual(690)
      expect(remaining).toBeLessThanOrEqual(710)
    })

    it('should return null for non-existent workflow timeout', () => {
      const remaining = manager.getWorkflowTimeoutRemaining('non-existent')

      expect(remaining).toBeNull()
    })
  })
})

// ============================================================================
// Activity Heartbeat Timeout (Session Window with Gap)
// ============================================================================

describe('TimerWindowManager - Activity Heartbeat Timeout', () => {
  let manager: TimerWindowManager

  beforeEach(() => {
    vi.useFakeTimers()
    manager = createTimerWindowManager()
  })

  afterEach(() => {
    manager.dispose()
    vi.useRealTimers()
  })

  describe('startHeartbeatTracking()', () => {
    it('should track heartbeats with session window gap', () => {
      manager.startHeartbeatTracking({
        activityId: 'activity-1',
        heartbeatTimeout: seconds(30),
      })

      expect(manager.isActivityHeartbeatActive('activity-1')).toBe(true)
    })

    it('should reset heartbeat timeout on each heartbeat', async () => {
      let timedOut = false

      manager.startHeartbeatTracking({
        activityId: 'activity-2',
        heartbeatTimeout: milliseconds(100),
        onHeartbeatTimeout: () => {
          timedOut = true
        },
      })

      // Heartbeat at 50ms
      vi.advanceTimersByTime(50)
      manager.recordHeartbeat('activity-2')

      // Heartbeat at 100ms (50ms after last heartbeat)
      vi.advanceTimersByTime(50)
      manager.recordHeartbeat('activity-2')

      // Heartbeat at 150ms (50ms after last heartbeat)
      vi.advanceTimersByTime(50)
      manager.recordHeartbeat('activity-2')

      await Promise.resolve()

      // Should not have timed out because we kept heartbeating
      expect(timedOut).toBe(false)
    })

    it('should fire callback when heartbeat timeout is exceeded', async () => {
      let timedOut = false

      manager.startHeartbeatTracking({
        activityId: 'activity-3',
        heartbeatTimeout: milliseconds(100),
        onHeartbeatTimeout: () => {
          timedOut = true
        },
      })

      // Don't heartbeat, just wait for timeout
      vi.advanceTimersByTime(150)
      await Promise.resolve()

      expect(timedOut).toBe(true)
    })

    it('should stop heartbeat tracking', () => {
      manager.startHeartbeatTracking({
        activityId: 'activity-4',
        heartbeatTimeout: seconds(30),
      })

      manager.stopHeartbeatTracking('activity-4')

      expect(manager.isActivityHeartbeatActive('activity-4')).toBe(false)
    })

    it('should not fire callback after tracking is stopped', async () => {
      let timedOut = false

      manager.startHeartbeatTracking({
        activityId: 'activity-5',
        heartbeatTimeout: milliseconds(100),
        onHeartbeatTimeout: () => {
          timedOut = true
        },
      })

      manager.stopHeartbeatTracking('activity-5')

      vi.advanceTimersByTime(150)
      await Promise.resolve()

      expect(timedOut).toBe(false)
    })

    it('should return last heartbeat timestamp', () => {
      manager.startHeartbeatTracking({
        activityId: 'activity-6',
        heartbeatTimeout: seconds(30),
      })

      const initialTimestamp = manager.getLastHeartbeat('activity-6')

      // Use manager.advanceTime() to update currentTime
      manager.advanceTime(100)
      manager.recordHeartbeat('activity-6')

      const newTimestamp = manager.getLastHeartbeat('activity-6')

      expect(newTimestamp).toBeGreaterThan(initialTimestamp!)
    })

    it('should support heartbeat with details', () => {
      manager.startHeartbeatTracking({
        activityId: 'activity-7',
        heartbeatTimeout: seconds(30),
      })

      manager.recordHeartbeat('activity-7', { progress: 50, message: 'Half done' })

      const details = manager.getHeartbeatDetails('activity-7')

      expect(details).toEqual({ progress: 50, message: 'Half done' })
    })
  })
})

// ============================================================================
// Schedule-to-Close Timeout (Window with Start/End)
// ============================================================================

describe('TimerWindowManager - Schedule-to-Close Timeout', () => {
  let manager: TimerWindowManager

  beforeEach(() => {
    vi.useFakeTimers()
    manager = createTimerWindowManager()
  })

  afterEach(() => {
    manager.dispose()
    vi.useRealTimers()
  })

  describe('setActivityTimeout()', () => {
    it('should track activity schedule-to-close timeout', () => {
      manager.setActivityTimeout({
        activityId: 'activity-1',
        scheduleToCloseTimeout: minutes(5),
      })

      expect(manager.hasActivityTimeout('activity-1')).toBe(true)
    })

    it('should fire callback when schedule-to-close is exceeded', async () => {
      let timedOut = false

      manager.setActivityTimeout({
        activityId: 'activity-2',
        scheduleToCloseTimeout: milliseconds(100),
        onTimeout: () => {
          timedOut = true
        },
      })

      vi.advanceTimersByTime(150)
      await Promise.resolve()

      expect(timedOut).toBe(true)
    })

    it('should support start-to-close timeout', () => {
      manager.setActivityTimeout({
        activityId: 'activity-3',
        startToCloseTimeout: minutes(3),
      })

      expect(manager.hasActivityTimeout('activity-3')).toBe(true)
    })

    it('should clear activity timeout', () => {
      manager.setActivityTimeout({
        activityId: 'activity-4',
        scheduleToCloseTimeout: minutes(5),
      })

      manager.clearActivityTimeout('activity-4')

      expect(manager.hasActivityTimeout('activity-4')).toBe(false)
    })

    it('should return remaining time', () => {
      manager.setActivityTimeout({
        activityId: 'activity-5',
        scheduleToCloseTimeout: milliseconds(1000),
      })

      // Use manager.advanceTime() to update currentTime for remaining calculations
      manager.advanceTime(300)

      const remaining = manager.getActivityTimeoutRemaining('activity-5')

      expect(remaining).toBeGreaterThanOrEqual(690)
      expect(remaining).toBeLessThanOrEqual(710)
    })
  })
})

// ============================================================================
// WindowManager Integration
// ============================================================================

describe('TimerWindowManager - WindowManager Integration', () => {
  let manager: TimerWindowManager

  beforeEach(() => {
    vi.useFakeTimers()
    manager = createTimerWindowManager()
  })

  afterEach(() => {
    manager.dispose()
    vi.useRealTimers()
  })

  describe('advanceTime() for testing', () => {
    it('should manually advance time and fire timers', async () => {
      let fired = false

      manager.createTimer({
        duration: milliseconds(100),
        onFire: () => {
          fired = true
        },
      })

      manager.advanceTime(50)
      expect(fired).toBe(false)

      manager.advanceTime(60)
      await Promise.resolve()

      expect(fired).toBe(true)
    })

    it('should fire multiple timers when advancing past their deadlines', async () => {
      const fired: string[] = []

      const t1 = manager.createTimer({
        duration: milliseconds(100),
        timerId: 't1',
        onFire: () => fired.push('t1'),
      })

      const t2 = manager.createTimer({
        duration: milliseconds(200),
        timerId: 't2',
        onFire: () => fired.push('t2'),
      })

      const t3 = manager.createTimer({
        duration: milliseconds(300),
        timerId: 't3',
        onFire: () => fired.push('t3'),
      })

      manager.advanceTime(250)
      await Promise.resolve()
      await Promise.resolve()

      expect(fired).toContain('t1')
      expect(fired).toContain('t2')
      expect(fired).not.toContain('t3')

      // Cancel remaining timer to prevent unhandled rejection in afterEach
      t3.cancel()
      await t3.promise.catch(() => {})
    })
  })

  describe('getActiveWindowCount()', () => {
    it('should return count of active windows', async () => {
      expect(manager.getActiveWindowCount()).toBe(0)

      const t1 = manager.createTimer({ duration: milliseconds(100) })
      expect(manager.getActiveWindowCount()).toBe(1)

      const t2 = manager.createTimer({ duration: milliseconds(200) })
      expect(manager.getActiveWindowCount()).toBe(2)

      t1.cancel()
      expect(manager.getActiveWindowCount()).toBe(1)

      t2.cancel()
      expect(manager.getActiveWindowCount()).toBe(0)

      await t1.promise.catch(() => {}) // Catch cancellation rejection
      await t2.promise.catch(() => {}) // Catch cancellation rejection
    })
  })

  describe('getWatermark()', () => {
    it('should return current watermark', () => {
      const initialWatermark = manager.getWatermark()

      manager.advanceTime(1000)

      expect(manager.getWatermark()).toBe(initialWatermark + 1000)
    })
  })
})

// ============================================================================
// Cleanup and Resource Management
// ============================================================================

describe('TimerWindowManager - Cleanup', () => {
  let manager: TimerWindowManager

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('dispose()', () => {
    it('should cancel all active timers', async () => {
      manager = createTimerWindowManager()

      const t1 = manager.createTimer({ duration: seconds(10) })
      const t2 = manager.createTimer({ duration: seconds(20) })

      manager.dispose()

      expect(t1.pending).toBe(false)
      expect(t2.pending).toBe(false)

      // Catch the rejections to prevent unhandled rejection errors
      await t1.promise.catch(() => {})
      await t2.promise.catch(() => {})
    })

    it('should reject all pending timer promises', async () => {
      manager = createTimerWindowManager()

      const t1 = manager.createTimer({ duration: seconds(10) })
      const t2 = manager.createTimer({ duration: seconds(20) })

      manager.dispose()

      await expect(t1.promise).rejects.toThrow(/disposed/i)
      await expect(t2.promise).rejects.toThrow(/disposed/i)
    })

    it('should clear all workflow timeouts', async () => {
      manager = createTimerWindowManager()
      let timedOut = false

      manager.setWorkflowTimeout({
        workflowId: 'wf-1',
        timeout: milliseconds(100),
        onTimeout: () => {
          timedOut = true
        },
      })

      manager.dispose()

      vi.advanceTimersByTime(150)
      await Promise.resolve()

      expect(timedOut).toBe(false)
    })

    it('should stop all heartbeat tracking', async () => {
      manager = createTimerWindowManager()
      let timedOut = false

      manager.startHeartbeatTracking({
        activityId: 'a1',
        heartbeatTimeout: milliseconds(100),
        onHeartbeatTimeout: () => {
          timedOut = true
        },
      })

      manager.dispose()

      vi.advanceTimersByTime(150)
      await Promise.resolve()

      expect(timedOut).toBe(false)
    })

    it('should be safe to call multiple times', () => {
      manager = createTimerWindowManager()

      expect(() => {
        manager.dispose()
        manager.dispose()
        manager.dispose()
      }).not.toThrow()
    })
  })

  describe('stale timer cleanup', () => {
    it('should automatically clean up stale timers', async () => {
      manager = createTimerWindowManager({
        staleTimerThreshold: milliseconds(1000),
        cleanupInterval: milliseconds(500),
      })

      const handle = manager.createTimer({ duration: milliseconds(100) })

      // Simulate timer never firing (stale condition)
      vi.advanceTimersByTime(100)
      // Don't await the promise - leave it pending

      // Advance past stale threshold
      vi.advanceTimersByTime(1500)

      // Cleanup should have run and removed stale timer
      expect(manager.getActiveTimerCount()).toBe(0)

      manager.dispose()
    })
  })
})

// ============================================================================
// Metrics Integration
// ============================================================================

describe('TimerWindowManager - Metrics', () => {
  it('should report timer metrics', async () => {
    const metrics = {
      incrementCounter: vi.fn(),
      recordLatency: vi.fn(),
      recordGauge: vi.fn(),
    }

    const manager = createTimerWindowManager({ metrics })

    const handle = manager.createTimer({ duration: milliseconds(100) })

    expect(metrics.incrementCounter).toHaveBeenCalled()

    handle.cancel()
    await handle.promise.catch(() => {}) // Catch the cancellation rejection

    manager.dispose()
  })

  it('should report cancellation metrics', async () => {
    const metrics = {
      incrementCounter: vi.fn(),
      recordLatency: vi.fn(),
      recordGauge: vi.fn(),
    }

    const manager = createTimerWindowManager({ metrics })

    const handle = manager.createTimer({ duration: milliseconds(100) })
    handle.cancel()

    // The cancel metric is called with "timer.cancelled"
    expect(metrics.incrementCounter).toHaveBeenCalledWith(
      'timer.cancelled',
      expect.objectContaining({ timerId: expect.any(String) })
    )

    await handle.promise.catch(() => {}) // Catch the cancellation rejection

    manager.dispose()
  })
})

// ============================================================================
// Factory and Configuration
// ============================================================================

describe('TimerWindowManager - Factory', () => {
  it('should create manager with default options', () => {
    const manager = createTimerWindowManager()

    expect(manager).toBeDefined()
    expect(typeof manager.createTimer).toBe('function')
    expect(typeof manager.sleep).toBe('function')
    expect(typeof manager.dispose).toBe('function')

    manager.dispose()
  })

  it('should accept custom coalesce window', () => {
    const manager = createTimerWindowManager({
      coalesceWindow: milliseconds(50),
    })

    expect(manager).toBeDefined()

    manager.dispose()
  })

  it('should accept metrics collector', () => {
    const metrics = {
      incrementCounter: vi.fn(),
      recordLatency: vi.fn(),
      recordGauge: vi.fn(),
    }

    const manager = createTimerWindowManager({ metrics })

    expect(manager).toBeDefined()

    manager.dispose()
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('TimerWindowManager - Edge Cases', () => {
  let manager: TimerWindowManager

  beforeEach(() => {
    manager = createTimerWindowManager()
  })

  afterEach(() => {
    manager.dispose()
  })

  it('should handle zero duration timer', async () => {
    const start = Date.now()
    const handle = manager.createTimer({ duration: milliseconds(0) })

    await handle.promise

    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(50) // Should complete quickly
  })

  it('should handle very small duration timer', async () => {
    const start = Date.now()
    const handle = manager.createTimer({ duration: milliseconds(1) })

    await handle.promise

    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(50)
  })

  it('should handle concurrent timer creation', async () => {
    const timers = Array.from({ length: 100 }, (_, i) =>
      manager.createTimer({ duration: milliseconds(50), timerId: `timer-${i}` })
    )

    await Promise.all(timers.map(t => t.promise))

    expect(manager.getActiveTimerCount()).toBe(0)
  })

  it('should handle duplicate timer ID', async () => {
    const t1 = manager.createTimer({ duration: milliseconds(100), timerId: 'dup' })

    // Second timer with same ID should replace or coexist (implementation choice)
    expect(() => {
      manager.createTimer({ duration: milliseconds(100), timerId: 'dup' })
    }).toThrow(/duplicate/i)

    t1.cancel()
    await t1.promise.catch(() => {}) // Catch the cancellation rejection
  })

  it('should handle recordHeartbeat for non-existent activity', () => {
    // Should not throw
    expect(() => {
      manager.recordHeartbeat('non-existent-activity')
    }).not.toThrow()
  })
})
