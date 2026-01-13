/**
 * HeartbeatMonitor, ReconnectionManager, and StateSynchronizer Tests
 *
 * Tests for production-grade connection management primitives:
 * - HeartbeatMonitor: Configurable intervals, connection health monitoring
 * - ReconnectionManager: Exponential backoff, retry limits
 * - StateSynchronizer: State diff and resync after reconnect
 *
 * @module db/primitives/sync/tests/heartbeat.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Import the modules we'll implement
import {
  HeartbeatMonitor,
  createHeartbeatMonitor,
  ReconnectionManager,
  createReconnectionManager,
  StateSynchronizer,
  createStateSynchronizer,
  type HeartbeatConfig,
  type HeartbeatState,
  type ReconnectionConfig,
  type ReconnectionState,
  type SyncState,
  type StateSyncResult,
} from '../heartbeat'

// =============================================================================
// HEARTBEAT MONITOR TESTS
// =============================================================================

describe('HeartbeatMonitor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('configuration', () => {
    it('should accept custom heartbeat interval', () => {
      const config: HeartbeatConfig = {
        intervalMs: 15000, // 15 seconds
        timeoutMs: 20000,
      }

      const monitor = createHeartbeatMonitor(config)

      expect(monitor.getConfig().intervalMs).toBe(15000)
    })

    it('should accept custom timeout duration', () => {
      const config: HeartbeatConfig = {
        intervalMs: 30000,
        timeoutMs: 45000, // 45 seconds
      }

      const monitor = createHeartbeatMonitor(config)

      expect(monitor.getConfig().timeoutMs).toBe(45000)
    })

    it('should use default values when not specified', () => {
      const monitor = createHeartbeatMonitor()

      const config = monitor.getConfig()
      expect(config.intervalMs).toBe(30000) // Default 30 seconds
      expect(config.timeoutMs).toBe(45000) // Default 45 seconds
    })

    it('should validate that timeout is greater than interval', () => {
      expect(() =>
        createHeartbeatMonitor({
          intervalMs: 30000,
          timeoutMs: 10000, // Invalid: timeout < interval
        })
      ).toThrow('Timeout must be greater than interval')
    })
  })

  describe('starting and stopping', () => {
    it('should start heartbeat monitoring', () => {
      const monitor = createHeartbeatMonitor()

      expect(monitor.isRunning()).toBe(false)
      monitor.start()
      expect(monitor.isRunning()).toBe(true)
    })

    it('should stop heartbeat monitoring', () => {
      const monitor = createHeartbeatMonitor()

      monitor.start()
      expect(monitor.isRunning()).toBe(true)

      monitor.stop()
      expect(monitor.isRunning()).toBe(false)
    })

    it('should be idempotent when starting multiple times', () => {
      const monitor = createHeartbeatMonitor()
      const onPing = vi.fn()
      monitor.onPing(onPing)

      monitor.start()
      monitor.start() // Should be no-op

      vi.advanceTimersByTime(30000)

      // Should only trigger one ping per interval
      expect(onPing).toHaveBeenCalledTimes(1)
    })

    it('should be idempotent when stopping multiple times', () => {
      const monitor = createHeartbeatMonitor()

      monitor.start()
      monitor.stop()
      monitor.stop() // Should not throw

      expect(monitor.isRunning()).toBe(false)
    })
  })

  describe('ping/pong cycle', () => {
    it('should emit ping events at configured interval', async () => {
      const monitor = createHeartbeatMonitor({ intervalMs: 10000, timeoutMs: 15000 })
      const onPing = vi.fn()
      monitor.onPing(onPing)

      monitor.start()

      await vi.advanceTimersByTimeAsync(10000)
      expect(onPing).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(10000)
      expect(onPing).toHaveBeenCalledTimes(2)
    })

    it('should include timestamp in ping event', async () => {
      const monitor = createHeartbeatMonitor({ intervalMs: 10000, timeoutMs: 15000 })
      const onPing = vi.fn()
      monitor.onPing(onPing)

      const now = Date.now()
      monitor.start()
      await vi.advanceTimersByTimeAsync(10000)

      expect(onPing).toHaveBeenCalledWith(expect.objectContaining({
        timestamp: expect.any(Number),
      }))
    })

    it('should update last pong time when pong is received', () => {
      const monitor = createHeartbeatMonitor()
      monitor.start()

      const beforePong = monitor.getState().lastPongAt
      monitor.receivePong({ timestamp: Date.now() })
      const afterPong = monitor.getState().lastPongAt

      expect(afterPong).toBeGreaterThanOrEqual(beforePong)
    })

    it('should clear pending ping when pong is received', async () => {
      const monitor = createHeartbeatMonitor({ intervalMs: 10000, timeoutMs: 15000 })
      monitor.start()

      await vi.advanceTimersByTimeAsync(10000) // Ping sent
      expect(monitor.getState().pendingPing).toBe(true)

      monitor.receivePong({ timestamp: Date.now() })
      expect(monitor.getState().pendingPing).toBe(false)
    })

    it('should not send another ping if previous ping has no response', async () => {
      const monitor = createHeartbeatMonitor({ intervalMs: 10000, timeoutMs: 20000 })
      const onPing = vi.fn()
      monitor.onPing(onPing)

      monitor.start()

      await vi.advanceTimersByTimeAsync(10000) // First ping
      expect(onPing).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(10000) // Second interval - should NOT ping
      expect(onPing).toHaveBeenCalledTimes(1) // Still 1
    })
  })

  describe('connection health monitoring', () => {
    it('should detect healthy connection', async () => {
      const monitor = createHeartbeatMonitor({ intervalMs: 10000, timeoutMs: 20000 })
      monitor.start()

      await vi.advanceTimersByTimeAsync(10000)
      monitor.receivePong({ timestamp: Date.now() })

      expect(monitor.isHealthy()).toBe(true)
    })

    it('should detect stale connection after timeout', async () => {
      const monitor = createHeartbeatMonitor({ intervalMs: 10000, timeoutMs: 20000 })
      monitor.start()

      // No pong received, advance past timeout
      await vi.advanceTimersByTimeAsync(25000)

      expect(monitor.isHealthy()).toBe(false)
    })

    it('should emit timeout event when connection times out', async () => {
      const monitor = createHeartbeatMonitor({ intervalMs: 10000, timeoutMs: 20000 })
      const onTimeout = vi.fn()
      monitor.onTimeout(onTimeout)

      monitor.start()
      await vi.advanceTimersByTimeAsync(10000) // First ping
      await vi.advanceTimersByTimeAsync(15000) // Past timeout (10 + 15 = 25 > 20)

      expect(onTimeout).toHaveBeenCalledTimes(1)
      expect(onTimeout).toHaveBeenCalledWith(expect.objectContaining({
        lastPongAge: expect.any(Number),
      }))
    })

    it('should not emit timeout if pong is received in time', async () => {
      const monitor = createHeartbeatMonitor({ intervalMs: 10000, timeoutMs: 20000 })
      const onTimeout = vi.fn()
      monitor.onTimeout(onTimeout)

      monitor.start()
      await vi.advanceTimersByTimeAsync(10000) // First ping
      monitor.receivePong({ timestamp: Date.now() })
      await vi.advanceTimersByTimeAsync(10000) // Second ping
      monitor.receivePong({ timestamp: Date.now() })

      expect(onTimeout).not.toHaveBeenCalled()
    })

    it('should reset health state when restarted', async () => {
      const monitor = createHeartbeatMonitor({ intervalMs: 10000, timeoutMs: 20000 })

      monitor.start()
      await vi.advanceTimersByTimeAsync(30000) // Timeout

      expect(monitor.isHealthy()).toBe(false)

      monitor.stop()
      monitor.reset()
      monitor.start()

      expect(monitor.isHealthy()).toBe(true)
    })
  })

  describe('state tracking', () => {
    it('should expose current state', () => {
      const monitor = createHeartbeatMonitor()

      const state = monitor.getState()

      expect(state).toHaveProperty('lastPongAt')
      expect(state).toHaveProperty('pendingPing')
      expect(state).toHaveProperty('missedPings')
    })

    it('should track number of missed pings', async () => {
      const monitor = createHeartbeatMonitor({ intervalMs: 10000, timeoutMs: 50000 })
      monitor.start()

      expect(monitor.getState().missedPings).toBe(0)

      await vi.advanceTimersByTimeAsync(10000) // First ping, no pong
      await vi.advanceTimersByTimeAsync(10000) // Check - still waiting
      expect(monitor.getState().missedPings).toBe(1)
    })
  })

  describe('cleanup', () => {
    it('should allow unsubscribing from ping events', async () => {
      const monitor = createHeartbeatMonitor({ intervalMs: 10000, timeoutMs: 15000 })
      const onPing = vi.fn()
      const unsubscribe = monitor.onPing(onPing)

      monitor.start()
      await vi.advanceTimersByTimeAsync(10000)
      expect(onPing).toHaveBeenCalledTimes(1)

      unsubscribe()
      await vi.advanceTimersByTimeAsync(10000)
      expect(onPing).toHaveBeenCalledTimes(1) // No new calls
    })

    it('should allow unsubscribing from timeout events', async () => {
      const monitor = createHeartbeatMonitor({ intervalMs: 10000, timeoutMs: 20000 })
      const onTimeout = vi.fn()
      const unsubscribe = monitor.onTimeout(onTimeout)

      monitor.start()
      unsubscribe()

      await vi.advanceTimersByTimeAsync(30000)
      expect(onTimeout).not.toHaveBeenCalled()
    })
  })
})

// =============================================================================
// RECONNECTION MANAGER TESTS
// =============================================================================

describe('ReconnectionManager', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('configuration', () => {
    it('should accept custom base delay', () => {
      const config: ReconnectionConfig = {
        baseDelayMs: 500,
        maxDelayMs: 30000,
        maxAttempts: 10,
      }

      const manager = createReconnectionManager(config)

      expect(manager.getConfig().baseDelayMs).toBe(500)
    })

    it('should accept custom max delay', () => {
      const config: ReconnectionConfig = {
        baseDelayMs: 1000,
        maxDelayMs: 60000, // 1 minute
        maxAttempts: 10,
      }

      const manager = createReconnectionManager(config)

      expect(manager.getConfig().maxDelayMs).toBe(60000)
    })

    it('should accept custom max attempts', () => {
      const config: ReconnectionConfig = {
        baseDelayMs: 1000,
        maxDelayMs: 30000,
        maxAttempts: 5,
      }

      const manager = createReconnectionManager(config)

      expect(manager.getConfig().maxAttempts).toBe(5)
    })

    it('should use default values when not specified', () => {
      const manager = createReconnectionManager()

      const config = manager.getConfig()
      expect(config.baseDelayMs).toBe(1000) // Default 1 second
      expect(config.maxDelayMs).toBe(30000) // Default 30 seconds
      expect(config.maxAttempts).toBe(Infinity) // Default unlimited
    })

    it('should accept jitter factor for randomization', () => {
      const config: ReconnectionConfig = {
        baseDelayMs: 1000,
        maxDelayMs: 30000,
        maxAttempts: 10,
        jitterFactor: 0.2, // 20% jitter
      }

      const manager = createReconnectionManager(config)

      expect(manager.getConfig().jitterFactor).toBe(0.2)
    })
  })

  describe('exponential backoff', () => {
    it('should calculate exponential delays', () => {
      const manager = createReconnectionManager({
        baseDelayMs: 1000,
        maxDelayMs: 30000,
        maxAttempts: 10,
        jitterFactor: 0, // No jitter for predictable tests
      })

      expect(manager.getNextDelay()).toBe(1000) // 1000 * 2^0
      manager.recordAttempt()

      expect(manager.getNextDelay()).toBe(2000) // 1000 * 2^1
      manager.recordAttempt()

      expect(manager.getNextDelay()).toBe(4000) // 1000 * 2^2
      manager.recordAttempt()

      expect(manager.getNextDelay()).toBe(8000) // 1000 * 2^3
    })

    it('should cap delay at max delay', () => {
      const manager = createReconnectionManager({
        baseDelayMs: 10000,
        maxDelayMs: 30000,
        maxAttempts: 10,
        jitterFactor: 0,
      })

      expect(manager.getNextDelay()).toBe(10000)
      manager.recordAttempt()

      expect(manager.getNextDelay()).toBe(20000)
      manager.recordAttempt()

      expect(manager.getNextDelay()).toBe(30000) // Capped at max
      manager.recordAttempt()

      expect(manager.getNextDelay()).toBe(30000) // Still capped
    })

    it('should apply jitter to delay', () => {
      const manager = createReconnectionManager({
        baseDelayMs: 1000,
        maxDelayMs: 30000,
        maxAttempts: 10,
        jitterFactor: 0.5, // 50% jitter
      })

      // With 50% jitter, delay should be between 500-1500ms
      const delay = manager.getNextDelay()
      expect(delay).toBeGreaterThanOrEqual(500)
      expect(delay).toBeLessThanOrEqual(1500)
    })
  })

  describe('reconnection scheduling', () => {
    it('should schedule reconnection after specified delay', async () => {
      const manager = createReconnectionManager({
        baseDelayMs: 1000,
        maxDelayMs: 30000,
        maxAttempts: 10,
        jitterFactor: 0,
      })

      const onReconnect = vi.fn()
      manager.onReconnect(onReconnect)

      manager.scheduleReconnect()

      expect(onReconnect).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1000)

      expect(onReconnect).toHaveBeenCalledTimes(1)
    })

    it('should emit attempt event with attempt number', async () => {
      const manager = createReconnectionManager({
        baseDelayMs: 100,
        maxDelayMs: 1000,
        maxAttempts: 10,
        jitterFactor: 0,
      })

      const onAttempt = vi.fn()
      manager.onAttempt(onAttempt)

      manager.scheduleReconnect()
      await vi.advanceTimersByTimeAsync(100)

      expect(onAttempt).toHaveBeenCalledWith(expect.objectContaining({
        attempt: 1,
      }))

      manager.scheduleReconnect()
      await vi.advanceTimersByTimeAsync(200)

      expect(onAttempt).toHaveBeenCalledWith(expect.objectContaining({
        attempt: 2,
      }))
    })

    it('should cancel pending reconnection', async () => {
      const manager = createReconnectionManager({
        baseDelayMs: 1000,
        maxDelayMs: 30000,
        maxAttempts: 10,
        jitterFactor: 0,
      })

      const onReconnect = vi.fn()
      manager.onReconnect(onReconnect)

      manager.scheduleReconnect()
      manager.cancel()

      await vi.advanceTimersByTimeAsync(2000)

      expect(onReconnect).not.toHaveBeenCalled()
    })

    it('should replace pending reconnection when scheduling again', async () => {
      const manager = createReconnectionManager({
        baseDelayMs: 1000,
        maxDelayMs: 30000,
        maxAttempts: 10,
        jitterFactor: 0,
      })

      const onReconnect = vi.fn()
      manager.onReconnect(onReconnect)

      manager.scheduleReconnect()
      await vi.advanceTimersByTimeAsync(500) // Halfway through

      manager.scheduleReconnect() // Reschedule
      await vi.advanceTimersByTimeAsync(1500) // First would have fired

      expect(onReconnect).toHaveBeenCalledTimes(1) // Only second one fired
    })
  })

  describe('attempt limits', () => {
    it('should stop after max attempts', async () => {
      const manager = createReconnectionManager({
        baseDelayMs: 100,
        maxDelayMs: 1000,
        maxAttempts: 3,
        jitterFactor: 0,
      })

      const onReconnect = vi.fn()
      const onExhausted = vi.fn()
      manager.onReconnect(onReconnect)
      manager.onExhausted(onExhausted)

      // First attempt
      manager.scheduleReconnect()
      await vi.advanceTimersByTimeAsync(100)

      // Second attempt
      manager.scheduleReconnect()
      await vi.advanceTimersByTimeAsync(200)

      // Third attempt (last)
      manager.scheduleReconnect()
      await vi.advanceTimersByTimeAsync(400)

      expect(onReconnect).toHaveBeenCalledTimes(3)

      // Fourth attempt should trigger exhausted
      manager.scheduleReconnect()
      expect(onExhausted).toHaveBeenCalledTimes(1)
    })

    it('should emit exhausted event when attempts are exhausted', async () => {
      const manager = createReconnectionManager({
        baseDelayMs: 100,
        maxDelayMs: 1000,
        maxAttempts: 2,
        jitterFactor: 0,
      })

      const onExhausted = vi.fn()
      manager.onExhausted(onExhausted)

      manager.scheduleReconnect()
      await vi.advanceTimersByTimeAsync(100)

      manager.scheduleReconnect()
      await vi.advanceTimersByTimeAsync(200)

      manager.scheduleReconnect() // Third attempt - should exhaust

      expect(onExhausted).toHaveBeenCalledWith(expect.objectContaining({
        totalAttempts: 2,
      }))
    })

    it('should not emit exhausted with unlimited attempts', async () => {
      const manager = createReconnectionManager({
        baseDelayMs: 100,
        maxDelayMs: 1000,
        maxAttempts: Infinity,
        jitterFactor: 0,
      })

      const onExhausted = vi.fn()
      manager.onExhausted(onExhausted)

      for (let i = 0; i < 100; i++) {
        manager.scheduleReconnect()
        await vi.advanceTimersByTimeAsync(1000)
      }

      expect(onExhausted).not.toHaveBeenCalled()
    })
  })

  describe('state management', () => {
    it('should track current attempt number', () => {
      const manager = createReconnectionManager()

      expect(manager.getState().attempts).toBe(0)

      manager.recordAttempt()
      expect(manager.getState().attempts).toBe(1)

      manager.recordAttempt()
      expect(manager.getState().attempts).toBe(2)
    })

    it('should reset attempts on success', () => {
      const manager = createReconnectionManager()

      manager.recordAttempt()
      manager.recordAttempt()
      expect(manager.getState().attempts).toBe(2)

      manager.recordSuccess()
      expect(manager.getState().attempts).toBe(0)
    })

    it('should expose isPending state', async () => {
      const manager = createReconnectionManager({
        baseDelayMs: 1000,
        maxDelayMs: 30000,
        maxAttempts: 10,
        jitterFactor: 0,
      })

      expect(manager.getState().isPending).toBe(false)

      manager.scheduleReconnect()
      expect(manager.getState().isPending).toBe(true)

      await vi.advanceTimersByTimeAsync(1000)
      expect(manager.getState().isPending).toBe(false)
    })

    it('should track next reconnect time', async () => {
      const manager = createReconnectionManager({
        baseDelayMs: 1000,
        maxDelayMs: 30000,
        maxAttempts: 10,
        jitterFactor: 0,
      })

      expect(manager.getState().nextReconnectAt).toBeNull()

      const beforeSchedule = Date.now()
      manager.scheduleReconnect()
      const state = manager.getState()

      expect(state.nextReconnectAt).not.toBeNull()
      expect(state.nextReconnectAt!).toBeGreaterThanOrEqual(beforeSchedule + 1000)
    })
  })

  describe('cleanup', () => {
    it('should allow unsubscribing from reconnect events', async () => {
      const manager = createReconnectionManager({
        baseDelayMs: 100,
        maxDelayMs: 1000,
        maxAttempts: 10,
        jitterFactor: 0,
      })

      const onReconnect = vi.fn()
      const unsubscribe = manager.onReconnect(onReconnect)

      manager.scheduleReconnect()
      await vi.advanceTimersByTimeAsync(100)
      expect(onReconnect).toHaveBeenCalledTimes(1)

      unsubscribe()

      manager.scheduleReconnect()
      await vi.advanceTimersByTimeAsync(200)
      expect(onReconnect).toHaveBeenCalledTimes(1) // No new calls
    })

    it('should clean up timers on cancel', async () => {
      const manager = createReconnectionManager({
        baseDelayMs: 1000,
        maxDelayMs: 30000,
        maxAttempts: 10,
        jitterFactor: 0,
      })

      manager.scheduleReconnect()
      expect(manager.getState().isPending).toBe(true)

      manager.cancel()
      expect(manager.getState().isPending).toBe(false)

      await vi.advanceTimersByTimeAsync(5000)
      // No errors should occur
    })
  })
})

// =============================================================================
// STATE SYNCHRONIZER TESTS
// =============================================================================

describe('StateSynchronizer', () => {
  describe('state tracking', () => {
    it('should track last known txid per collection', () => {
      const synchronizer = createStateSynchronizer()

      synchronizer.recordTxid('Task', 100)
      synchronizer.recordTxid('User', 50)

      expect(synchronizer.getLastTxid('Task')).toBe(100)
      expect(synchronizer.getLastTxid('User')).toBe(50)
    })

    it('should update txid when higher', () => {
      const synchronizer = createStateSynchronizer()

      synchronizer.recordTxid('Task', 100)
      synchronizer.recordTxid('Task', 150)

      expect(synchronizer.getLastTxid('Task')).toBe(150)
    })

    it('should not downgrade txid', () => {
      const synchronizer = createStateSynchronizer()

      synchronizer.recordTxid('Task', 100)
      synchronizer.recordTxid('Task', 50) // Lower value

      expect(synchronizer.getLastTxid('Task')).toBe(100) // Should stay at 100
    })

    it('should return null for unknown collections', () => {
      const synchronizer = createStateSynchronizer()

      expect(synchronizer.getLastTxid('Unknown')).toBeNull()
    })
  })

  describe('subscription tracking', () => {
    it('should track active subscriptions', () => {
      const synchronizer = createStateSynchronizer()

      synchronizer.addSubscription('Task', 'main')
      synchronizer.addSubscription('User', null)

      const subscriptions = synchronizer.getSubscriptions()
      expect(subscriptions).toHaveLength(2)
      expect(subscriptions).toContainEqual({ collection: 'Task', branch: 'main' })
      expect(subscriptions).toContainEqual({ collection: 'User', branch: null })
    })

    it('should remove subscriptions', () => {
      const synchronizer = createStateSynchronizer()

      synchronizer.addSubscription('Task', 'main')
      synchronizer.addSubscription('User', null)

      synchronizer.removeSubscription('Task', 'main')

      const subscriptions = synchronizer.getSubscriptions()
      expect(subscriptions).toHaveLength(1)
      expect(subscriptions).toContainEqual({ collection: 'User', branch: null })
    })

    it('should not add duplicate subscriptions', () => {
      const synchronizer = createStateSynchronizer()

      synchronizer.addSubscription('Task', 'main')
      synchronizer.addSubscription('Task', 'main') // Duplicate

      const subscriptions = synchronizer.getSubscriptions()
      expect(subscriptions).toHaveLength(1)
    })
  })

  describe('optimistic state preservation', () => {
    it('should preserve pending mutations during disconnect', () => {
      const synchronizer = createStateSynchronizer()

      const mutation1 = { id: 'mut-1', collection: 'Task', operation: 'update' as const, key: 'task-1', data: { name: 'Updated' } }
      const mutation2 = { id: 'mut-2', collection: 'Task', operation: 'insert' as const, key: 'task-2', data: { name: 'New' } }

      synchronizer.addPendingMutation(mutation1)
      synchronizer.addPendingMutation(mutation2)

      const pending = synchronizer.getPendingMutations()
      expect(pending).toHaveLength(2)
    })

    it('should clear pending mutation after confirmation', () => {
      const synchronizer = createStateSynchronizer()

      const mutation = { id: 'mut-1', collection: 'Task', operation: 'update' as const, key: 'task-1', data: { name: 'Updated' } }

      synchronizer.addPendingMutation(mutation)
      expect(synchronizer.getPendingMutations()).toHaveLength(1)

      synchronizer.confirmMutation('mut-1')
      expect(synchronizer.getPendingMutations()).toHaveLength(0)
    })

    it('should preserve state during brief disconnects', () => {
      const synchronizer = createStateSynchronizer()

      // Simulate state before disconnect
      synchronizer.recordTxid('Task', 100)
      synchronizer.addSubscription('Task', null)
      synchronizer.addPendingMutation({ id: 'mut-1', collection: 'Task', operation: 'update' as const, key: 'task-1', data: {} })

      // Disconnect event
      synchronizer.onDisconnect()

      // State should be preserved
      expect(synchronizer.getLastTxid('Task')).toBe(100)
      expect(synchronizer.getSubscriptions()).toHaveLength(1)
      expect(synchronizer.getPendingMutations()).toHaveLength(1)
    })
  })

  describe('post-reconnect synchronization', () => {
    it('should generate resync plan with subscriptions', () => {
      const synchronizer = createStateSynchronizer()

      synchronizer.addSubscription('Task', null)
      synchronizer.addSubscription('User', 'main')
      synchronizer.recordTxid('Task', 100)
      synchronizer.recordTxid('User', 50)

      const plan = synchronizer.getResyncPlan()

      expect(plan).toHaveLength(2)
      expect(plan).toContainEqual({
        collection: 'Task',
        branch: null,
        fromTxid: 100,
      })
      expect(plan).toContainEqual({
        collection: 'User',
        branch: 'main',
        fromTxid: 50,
      })
    })

    it('should handle collections with no prior txid', () => {
      const synchronizer = createStateSynchronizer()

      synchronizer.addSubscription('Task', null)
      // No txid recorded

      const plan = synchronizer.getResyncPlan()

      expect(plan).toHaveLength(1)
      expect(plan[0].fromTxid).toBeNull()
    })

    it('should detect and report missed changes', async () => {
      const synchronizer = createStateSynchronizer()

      synchronizer.recordTxid('Task', 100)

      // Simulate receiving initial state with higher txid
      const result = await synchronizer.processInitialState('Task', [
        { $id: 'task-1', name: 'Task 1' },
        { $id: 'task-2', name: 'Task 2' },
      ], 150)

      expect(result.missedChanges).toBe(true)
      expect(result.gapStart).toBe(100)
      expect(result.gapEnd).toBe(150)
    })

    it('should report no missed changes when txid matches', async () => {
      const synchronizer = createStateSynchronizer()

      synchronizer.recordTxid('Task', 100)

      const result = await synchronizer.processInitialState('Task', [], 100)

      expect(result.missedChanges).toBe(false)
    })

    it('should retry pending mutations after reconnect', async () => {
      const synchronizer = createStateSynchronizer()

      const mutation = { id: 'mut-1', collection: 'Task', operation: 'update' as const, key: 'task-1', data: { name: 'Updated' } }
      synchronizer.addPendingMutation(mutation)

      const mutationsToRetry = synchronizer.getMutationsToRetry()

      expect(mutationsToRetry).toHaveLength(1)
      expect(mutationsToRetry[0]).toEqual(mutation)
    })
  })

  describe('state diffing', () => {
    it('should compute diff between local and remote state', () => {
      const synchronizer = createStateSynchronizer()

      const localState = [
        { $id: 'task-1', name: 'Task 1', version: 1 },
        { $id: 'task-2', name: 'Task 2', version: 1 },
        { $id: 'task-3', name: 'Task 3', version: 1 },
      ]

      const remoteState = [
        { $id: 'task-1', name: 'Task 1 Updated', version: 2 }, // Updated
        { $id: 'task-2', name: 'Task 2', version: 1 }, // Unchanged
        // task-3 deleted
        { $id: 'task-4', name: 'Task 4', version: 1 }, // New
      ]

      const diff = synchronizer.computeDiff('Task', localState, remoteState)

      expect(diff.inserts).toHaveLength(1)
      expect(diff.inserts[0].$id).toBe('task-4')

      expect(diff.updates).toHaveLength(1)
      expect(diff.updates[0].$id).toBe('task-1')

      expect(diff.deletes).toHaveLength(1)
      expect(diff.deletes[0]).toBe('task-3')
    })

    it('should handle empty local state', () => {
      const synchronizer = createStateSynchronizer()

      const localState: any[] = []
      const remoteState = [
        { $id: 'task-1', name: 'Task 1' },
        { $id: 'task-2', name: 'Task 2' },
      ]

      const diff = synchronizer.computeDiff('Task', localState, remoteState)

      expect(diff.inserts).toHaveLength(2)
      expect(diff.updates).toHaveLength(0)
      expect(diff.deletes).toHaveLength(0)
    })

    it('should handle empty remote state', () => {
      const synchronizer = createStateSynchronizer()

      const localState = [
        { $id: 'task-1', name: 'Task 1' },
        { $id: 'task-2', name: 'Task 2' },
      ]
      const remoteState: any[] = []

      const diff = synchronizer.computeDiff('Task', localState, remoteState)

      expect(diff.inserts).toHaveLength(0)
      expect(diff.updates).toHaveLength(0)
      expect(diff.deletes).toHaveLength(2)
    })
  })

  describe('cleanup', () => {
    it('should clear all state on reset', () => {
      const synchronizer = createStateSynchronizer()

      synchronizer.recordTxid('Task', 100)
      synchronizer.addSubscription('Task', null)
      synchronizer.addPendingMutation({ id: 'mut-1', collection: 'Task', operation: 'update' as const, key: 'task-1', data: {} })

      synchronizer.reset()

      expect(synchronizer.getLastTxid('Task')).toBeNull()
      expect(synchronizer.getSubscriptions()).toHaveLength(0)
      expect(synchronizer.getPendingMutations()).toHaveLength(0)
    })

    it('should clear specific collection state', () => {
      const synchronizer = createStateSynchronizer()

      synchronizer.recordTxid('Task', 100)
      synchronizer.recordTxid('User', 50)

      synchronizer.clearCollection('Task')

      expect(synchronizer.getLastTxid('Task')).toBeNull()
      expect(synchronizer.getLastTxid('User')).toBe(50)
    })
  })
})
