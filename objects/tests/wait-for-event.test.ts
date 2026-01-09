/**
 * waitForEvent Integration Tests
 *
 * Tests for $.waitFor() in Durable Object workflows - allows workflows to
 * pause and wait for external events with hibernation support.
 *
 * This integrates with:
 * - DO storage for pending wait persistence
 * - Alarm API for timeout handling
 * - Event delivery for resumption
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// These imports will define the interface we need to implement
import {
  WaitForEventManager,
  type PendingWait,
  type WaitForEventOptions,
  type WaitResult,
  WaitTimeoutError,
  WaitCancelledError,
  WaitEventMismatchError,
} from '../WaitForEventManager'

// ============================================================================
// MOCK DO STATE
// ============================================================================

function createMockStorage() {
  const storage = new Map<string, unknown>()
  const alarms: { time: number | null; handler?: () => Promise<void> } = { time: null }

  return {
    storage: {
      get: vi.fn(async (key: string) => storage.get(key)),
      put: vi.fn(async (key: string, value: unknown) => {
        storage.set(key, value)
      }),
      delete: vi.fn(async (key: string) => storage.delete(key)),
      list: vi.fn(async (options?: { prefix?: string }) => {
        const result = new Map()
        for (const [key, value] of storage) {
          if (!options?.prefix || key.startsWith(options.prefix)) {
            result.set(key, value)
          }
        }
        return result
      }),
      getAlarm: vi.fn(async () => alarms.time),
      setAlarm: vi.fn(async (time: number | Date) => {
        alarms.time = typeof time === 'number' ? time : time.getTime()
      }),
      deleteAlarm: vi.fn(async () => {
        alarms.time = null
      }),
    },
    alarms,
    _storage: storage,
  }
}

function createMockState() {
  const { storage, alarms, _storage } = createMockStorage()
  return {
    id: { toString: () => 'test-workflow-do-id' },
    storage,
    alarms,
    _storage,
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async (fn: () => Promise<void>) => fn()),
  } as unknown as DurableObjectState & { alarms: { time: number | null }; _storage: Map<string, unknown> }
}

// ============================================================================
// TESTS
// ============================================================================

describe('WaitForEventManager', () => {
  let mockState: ReturnType<typeof createMockState>
  let manager: WaitForEventManager

  beforeEach(() => {
    mockState = createMockState()
    manager = new WaitForEventManager(mockState)
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ==========================================================================
  // 1. BASIC WAIT FUNCTIONALITY
  // ==========================================================================

  describe('Basic Wait Functionality', () => {
    it('creates a pending wait for a named event', async () => {
      const waitId = await manager.registerWait('manager-approval', {})

      expect(waitId).toBeDefined()
      expect(typeof waitId).toBe('string')

      const pending = await manager.getPendingWait(waitId)
      expect(pending).toBeDefined()
      expect(pending?.eventName).toBe('manager-approval')
      expect(pending?.status).toBe('pending')
    })

    it('resolves wait when matching event is received', async () => {
      const waitId = await manager.registerWait('approval', {})

      // Simulate receiving the event
      const result = await manager.deliverEvent(waitId, 'approval', {
        approved: true,
        approver: 'john@example.com',
      })

      expect(result.resolved).toBe(true)
      expect(result.payload).toEqual({
        approved: true,
        approver: 'john@example.com',
      })
    })

    it('returns event payload when wait completes', async () => {
      const waitPromise = manager.waitForEvent('customer-response', {})

      // Deliver event after a small delay
      setTimeout(() => {
        manager.deliverEvent(null, 'customer-response', {
          status: 'confirmed',
          message: 'Looks good!',
        })
      }, 100)

      vi.advanceTimersByTime(100)

      const result = await waitPromise

      expect(result).toEqual({
        status: 'confirmed',
        message: 'Looks good!',
      })
    })

    it('persists pending wait to DO storage', async () => {
      await manager.registerWait('my-event', {})

      // Verify storage was called
      expect(mockState.storage.put).toHaveBeenCalled()

      // Check the stored data
      const calls = (mockState.storage.put as ReturnType<typeof vi.fn>).mock.calls
      const waitCall = calls.find(([key]) => key.startsWith('wait:'))

      expect(waitCall).toBeDefined()
      const storedWait = waitCall![1] as PendingWait
      expect(storedWait.eventName).toBe('my-event')
    })

    it('removes pending wait from storage after resolution', async () => {
      const waitId = await manager.registerWait('event', {})

      await manager.deliverEvent(waitId, 'event', { data: 'payload' })

      // Verify deletion
      expect(mockState.storage.delete).toHaveBeenCalledWith(`wait:${waitId}`)
    })

    it('generates unique wait IDs', async () => {
      const ids = new Set<string>()

      for (let i = 0; i < 100; i++) {
        const id = await manager.registerWait(`event-${i}`, {})
        ids.add(id)
      }

      expect(ids.size).toBe(100)
    })
  })

  // ==========================================================================
  // 2. TIMEOUT HANDLING
  // ==========================================================================

  describe('Timeout Handling', () => {
    it('supports timeout option with duration string', async () => {
      const waitId = await manager.registerWait('approval', {
        timeout: '7 days',
      })

      const pending = await manager.getPendingWait(waitId)

      expect(pending?.timeoutAt).toBeDefined()

      // 7 days in milliseconds
      const expectedTimeout = Date.now() + 7 * 24 * 60 * 60 * 1000
      expect(pending?.timeoutAt).toBeCloseTo(expectedTimeout, -3) // within 1 second
    })

    it('supports timeout option with milliseconds', async () => {
      const waitId = await manager.registerWait('quick-response', {
        timeout: 5000,
      })

      const pending = await manager.getPendingWait(waitId)

      expect(pending?.timeoutAt).toBeDefined()
      expect(pending?.timeoutAt).toBeCloseTo(Date.now() + 5000, -3)
    })

    it('sets DO alarm for timeout', async () => {
      await manager.registerWait('approval', {
        timeout: '1 hour',
      })

      expect(mockState.storage.setAlarm).toHaveBeenCalled()

      const alarmTime = mockState.alarms.time
      expect(alarmTime).toBeCloseTo(Date.now() + 60 * 60 * 1000, -3)
    })

    it('throws WaitTimeoutError when timeout expires', async () => {
      const waitPromise = manager.waitForEvent('slow-response', {
        timeout: 1000,
      })

      // Advance time past timeout
      vi.advanceTimersByTime(1500)

      // Trigger the alarm handler
      await manager.handleAlarm()

      await expect(waitPromise).rejects.toThrow(WaitTimeoutError)
    })

    it('timeout error includes wait details', async () => {
      const waitPromise = manager.waitForEvent('my-event', {
        timeout: 500,
      })

      vi.advanceTimersByTime(600)
      await manager.handleAlarm()

      try {
        await waitPromise
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(WaitTimeoutError)
        expect((error as WaitTimeoutError).eventName).toBe('my-event')
        expect((error as WaitTimeoutError).waitedMs).toBeGreaterThanOrEqual(500)
      }
    })

    it('clears alarm when wait is resolved before timeout', async () => {
      const waitId = await manager.registerWait('event', {
        timeout: 10000,
      })

      // Resolve before timeout
      await manager.deliverEvent(waitId, 'event', {})

      // Alarm should be cleared if no other pending waits
      expect(mockState.storage.deleteAlarm).toHaveBeenCalled()
    })

    it('reschedules alarm for next pending wait after resolution', async () => {
      // Create two waits with different timeouts
      await manager.registerWait('event1', { timeout: 5000 })
      const wait2Id = await manager.registerWait('event2', { timeout: 10000 })

      // Clear mock to track new alarm
      ;(mockState.storage.setAlarm as ReturnType<typeof vi.fn>).mockClear()

      // Resolve first wait
      await manager.deliverEvent(null, 'event1', {})

      // Should reschedule alarm for event2's timeout
      expect(mockState.storage.setAlarm).toHaveBeenCalled()
    })

    it('supports no timeout (indefinite wait)', async () => {
      const waitId = await manager.registerWait('no-rush', {})

      const pending = await manager.getPendingWait(waitId)

      expect(pending?.timeoutAt).toBeUndefined()
    })
  })

  // ==========================================================================
  // 3. CANCELLATION
  // ==========================================================================

  describe('Cancellation', () => {
    it('can cancel a pending wait', async () => {
      const waitId = await manager.registerWait('event', {})

      const cancelled = await manager.cancelWait(waitId)

      expect(cancelled).toBe(true)

      const pending = await manager.getPendingWait(waitId)
      expect(pending).toBeUndefined()
    })

    it('cancelled wait throws WaitCancelledError', async () => {
      const waitPromise = manager.waitForEvent('event', {})

      // Get the wait ID from storage
      const waits = await mockState.storage.list({ prefix: 'wait:' })
      const waitId = Array.from(waits.keys())[0]?.replace('wait:', '')

      await manager.cancelWait(waitId!)

      await expect(waitPromise).rejects.toThrow(WaitCancelledError)
    })

    it('supports AbortSignal for cancellation', async () => {
      const controller = new AbortController()

      const waitPromise = manager.waitForEvent('event', {
        signal: controller.signal,
      })

      // Abort after a delay
      setTimeout(() => controller.abort(), 100)
      vi.advanceTimersByTime(100)

      await expect(waitPromise).rejects.toThrow(WaitCancelledError)
    })

    it('AbortSignal with reason includes reason in error', async () => {
      const controller = new AbortController()

      const waitPromise = manager.waitForEvent('event', {
        signal: controller.signal,
      })

      controller.abort('User cancelled')
      vi.advanceTimersByTime(0)

      try {
        await waitPromise
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(WaitCancelledError)
        expect((error as WaitCancelledError).reason).toBe('User cancelled')
      }
    })

    it('returns false when cancelling non-existent wait', async () => {
      const result = await manager.cancelWait('non-existent-id')

      expect(result).toBe(false)
    })

    it('cancellation cleans up storage', async () => {
      const waitId = await manager.registerWait('event', {})

      await manager.cancelWait(waitId)

      expect(mockState.storage.delete).toHaveBeenCalledWith(`wait:${waitId}`)
    })
  })

  // ==========================================================================
  // 4. MULTIPLE WAITS
  // ==========================================================================

  describe('Multiple Waits', () => {
    it('can have multiple pending waits for different events', async () => {
      const wait1 = await manager.registerWait('event-a', {})
      const wait2 = await manager.registerWait('event-b', {})
      const wait3 = await manager.registerWait('event-c', {})

      const pending = await manager.listPendingWaits()

      expect(pending).toHaveLength(3)
      expect(pending.map((w) => w.eventName)).toEqual(expect.arrayContaining(['event-a', 'event-b', 'event-c']))
    })

    it('waitForAny resolves with first event received', async () => {
      const waitPromise = manager.waitForAny(['approval', 'rejection', 'escalation'], {})

      // Deliver rejection event
      setTimeout(() => {
        manager.deliverEvent(null, 'rejection', { reason: 'Over budget' })
      }, 50)

      vi.advanceTimersByTime(50)

      const result = await waitPromise

      expect(result.eventName).toBe('rejection')
      expect(result.payload).toEqual({ reason: 'Over budget' })
    })

    it('waitForAny cancels remaining waits after resolution', async () => {
      const waitPromise = manager.waitForAny(['event-a', 'event-b', 'event-c'], {})

      // Deliver one event
      setTimeout(() => {
        manager.deliverEvent(null, 'event-b', {})
      }, 10)

      vi.advanceTimersByTime(10)
      await waitPromise

      // Check that other waits are cancelled
      const pending = await manager.listPendingWaits()
      expect(pending).toHaveLength(0)
    })

    it('waitForAll waits for all events', async () => {
      const waitPromise = manager.waitForAll(['approval-1', 'approval-2', 'approval-3'], {})

      // Deliver events one by one
      setTimeout(() => manager.deliverEvent(null, 'approval-1', { by: 'alice' }), 10)
      setTimeout(() => manager.deliverEvent(null, 'approval-2', { by: 'bob' }), 20)
      setTimeout(() => manager.deliverEvent(null, 'approval-3', { by: 'carol' }), 30)

      vi.advanceTimersByTime(30)

      const results = await waitPromise

      expect(results).toHaveLength(3)
      expect(results.map((r) => r.payload.by)).toEqual(expect.arrayContaining(['alice', 'bob', 'carol']))
    })

    it('waitForAll fails if any event times out', async () => {
      const waitPromise = manager.waitForAll(['event-a', 'event-b'], {
        timeout: 1000,
      })

      // Only deliver one event
      setTimeout(() => manager.deliverEvent(null, 'event-a', {}), 10)
      vi.advanceTimersByTime(10)

      // Advance past timeout
      vi.advanceTimersByTime(1500)
      await manager.handleAlarm()

      await expect(waitPromise).rejects.toThrow(WaitTimeoutError)
    })

    it('can wait for same event name from multiple instances', async () => {
      // This is for scenarios like waiting for multiple approvers
      const wait1 = await manager.registerWait('approval', { correlationId: 'approver-1' })
      const wait2 = await manager.registerWait('approval', { correlationId: 'approver-2' })

      // Deliver to specific wait
      await manager.deliverEvent(wait1, 'approval', { approved: true })

      // Second wait should still be pending
      const pending = await manager.getPendingWait(wait2)
      expect(pending).toBeDefined()
    })
  })

  // ==========================================================================
  // 5. EVENT FILTERING
  // ==========================================================================

  describe('Event Filtering', () => {
    it('supports filter function to match events', async () => {
      const waitPromise = manager.waitForEvent('order-update', {
        filter: (payload) => payload.status === 'shipped',
      })

      // Deliver non-matching event
      setTimeout(() => {
        manager.deliverEvent(null, 'order-update', { status: 'processing' })
      }, 10)

      // Deliver matching event
      setTimeout(() => {
        manager.deliverEvent(null, 'order-update', { status: 'shipped', carrier: 'FedEx' })
      }, 20)

      vi.advanceTimersByTime(20)

      const result = await waitPromise

      expect(result).toEqual({ status: 'shipped', carrier: 'FedEx' })
    })

    it('non-matching events do not resolve wait', async () => {
      let resolved = false
      const waitPromise = manager
        .waitForEvent('event', {
          filter: (p) => p.value > 10,
        })
        .then((r) => {
          resolved = true
          return r
        })

      // Deliver non-matching events
      await manager.deliverEvent(null, 'event', { value: 5 })
      await manager.deliverEvent(null, 'event', { value: 8 })

      expect(resolved).toBe(false)

      // Deliver matching event
      await manager.deliverEvent(null, 'event', { value: 15 })

      await waitPromise
      expect(resolved).toBe(true)
    })

    it('supports property-based filter shorthand', async () => {
      const waitPromise = manager.waitForEvent('notification', {
        filter: { type: 'approval', priority: 'high' },
      })

      // Non-matching
      await manager.deliverEvent(null, 'notification', { type: 'info' })
      await manager.deliverEvent(null, 'notification', { type: 'approval', priority: 'low' })

      // Matching
      setTimeout(() => {
        manager.deliverEvent(null, 'notification', {
          type: 'approval',
          priority: 'high',
          message: 'Approved!',
        })
      }, 10)

      vi.advanceTimersByTime(10)

      const result = await waitPromise

      expect(result.message).toBe('Approved!')
    })

    it('filter errors are logged and event is skipped', async () => {
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const waitPromise = manager.waitForEvent('event', {
        filter: () => {
          throw new Error('Filter error')
        },
      })

      await manager.deliverEvent(null, 'event', { data: 'test' })

      expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining('Filter error'), expect.anything())

      // Wait should still be pending
      const pending = await manager.listPendingWaits()
      expect(pending).toHaveLength(1)

      consoleWarn.mockRestore()
    })
  })

  // ==========================================================================
  // 6. HIBERNATION SUPPORT
  // ==========================================================================

  describe('Hibernation Support', () => {
    it('pending waits survive DO hibernation', async () => {
      // Register wait
      const waitId = await manager.registerWait('event', {
        timeout: '1 hour',
      })

      // Simulate hibernation by creating new manager with same storage
      const newManager = new WaitForEventManager(mockState)

      // Waits should be restored
      const pending = await newManager.getPendingWait(waitId)

      expect(pending).toBeDefined()
      expect(pending?.eventName).toBe('event')
    })

    it('restored waits can receive events', async () => {
      const waitId = await manager.registerWait('approval', {})

      // New manager (simulating wake from hibernation)
      const newManager = new WaitForEventManager(mockState)

      // Should be able to deliver event
      const result = await newManager.deliverEvent(waitId, 'approval', {
        approved: true,
      })

      expect(result.resolved).toBe(true)
    })

    it('timeout alarms are preserved across hibernation', async () => {
      await manager.registerWait('event', {
        timeout: 30000,
      })

      // Store original alarm time
      const originalAlarm = mockState.alarms.time

      // Simulate hibernation
      const newManager = new WaitForEventManager(mockState)
      await newManager.restoreFromStorage()

      // Alarm should still be set for original time
      expect(mockState.storage.getAlarm).toHaveBeenCalled()
    })

    it('handles concurrent event delivery during wake', async () => {
      const waitId = await manager.registerWait('event', {})

      // Simulate racing event delivery during wake
      const delivery1 = manager.deliverEvent(waitId, 'event', { source: 'a' })
      const delivery2 = manager.deliverEvent(waitId, 'event', { source: 'b' })

      const results = await Promise.all([delivery1, delivery2])

      // Only one should succeed
      const resolved = results.filter((r) => r.resolved)
      expect(resolved).toHaveLength(1)
    })
  })

  // ==========================================================================
  // 7. EVENT NAME VALIDATION
  // ==========================================================================

  describe('Event Name Validation', () => {
    it('rejects event delivery with wrong event name', async () => {
      const waitId = await manager.registerWait('expected-event', {})

      await expect(manager.deliverEvent(waitId, 'wrong-event', {})).rejects.toThrow(WaitEventMismatchError)
    })

    it('event mismatch error includes details', async () => {
      const waitId = await manager.registerWait('approval', {})

      try {
        await manager.deliverEvent(waitId, 'rejection', {})
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(WaitEventMismatchError)
        expect((error as WaitEventMismatchError).expected).toBe('approval')
        expect((error as WaitEventMismatchError).received).toBe('rejection')
      }
    })

    it('can deliver by event name when wait ID is null', async () => {
      await manager.registerWait('my-event', {})

      // Deliver without specifying wait ID
      const result = await manager.deliverEvent(null, 'my-event', { data: 'value' })

      expect(result.resolved).toBe(true)
    })

    it('returns not-found when no matching wait exists', async () => {
      const result = await manager.deliverEvent(null, 'unknown-event', {})

      expect(result.resolved).toBe(false)
      expect(result.reason).toBe('no-matching-wait')
    })
  })

  // ==========================================================================
  // 8. CORRELATION IDs
  // ==========================================================================

  describe('Correlation IDs', () => {
    it('supports correlation ID for targeted event delivery', async () => {
      await manager.registerWait('approval', { correlationId: 'request-123' })
      await manager.registerWait('approval', { correlationId: 'request-456' })

      // Deliver to specific correlation
      const result = await manager.deliverEventByCorrelation('approval', 'request-123', {
        approved: true,
      })

      expect(result.resolved).toBe(true)

      // Other wait should still be pending
      const pending = await manager.listPendingWaits()
      expect(pending).toHaveLength(1)
      expect(pending[0].options.correlationId).toBe('request-456')
    })

    it('correlation ID is included in pending wait', async () => {
      const waitId = await manager.registerWait('event', {
        correlationId: 'my-correlation',
      })

      const pending = await manager.getPendingWait(waitId)

      expect(pending?.options.correlationId).toBe('my-correlation')
    })
  })

  // ==========================================================================
  // 9. METRICS AND OBSERVABILITY
  // ==========================================================================

  describe('Metrics and Observability', () => {
    it('emits wait.registered event', async () => {
      const events: Array<{ type: string; data: unknown }> = []
      manager.on('wait.registered', (data) => events.push({ type: 'registered', data }))

      await manager.registerWait('approval', { timeout: 5000 })

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('registered')
      expect((events[0].data as { eventName: string }).eventName).toBe('approval')
    })

    it('emits wait.resolved event', async () => {
      const events: Array<{ type: string; data: unknown }> = []
      manager.on('wait.resolved', (data) => events.push({ type: 'resolved', data }))

      const waitId = await manager.registerWait('event', {})
      await manager.deliverEvent(waitId, 'event', { result: 'success' })

      expect(events).toHaveLength(1)
      expect((events[0].data as { payload: unknown }).payload).toEqual({ result: 'success' })
    })

    it('emits wait.timeout event', async () => {
      const events: Array<{ type: string; data: unknown }> = []
      manager.on('wait.timeout', (data) => events.push({ type: 'timeout', data }))

      await manager.registerWait('slow', { timeout: 100 })

      vi.advanceTimersByTime(150)
      await manager.handleAlarm()

      expect(events).toHaveLength(1)
    })

    it('emits wait.cancelled event', async () => {
      const events: Array<{ type: string; data: unknown }> = []
      manager.on('wait.cancelled', (data) => events.push({ type: 'cancelled', data }))

      const waitId = await manager.registerWait('event', {})
      await manager.cancelWait(waitId)

      expect(events).toHaveLength(1)
    })

    it('tracks wait duration on resolution', async () => {
      const waitId = await manager.registerWait('event', {})

      // Advance time
      vi.advanceTimersByTime(5000)

      const result = await manager.deliverEvent(waitId, 'event', {})

      expect(result.duration).toBeGreaterThanOrEqual(5000)
    })

    it('provides pending wait statistics', async () => {
      await manager.registerWait('event-a', { timeout: 5000 })
      await manager.registerWait('event-b', {})
      await manager.registerWait('event-c', { timeout: 10000 })

      const stats = await manager.getStats()

      expect(stats.pendingCount).toBe(3)
      expect(stats.withTimeout).toBe(2)
      expect(stats.withoutTimeout).toBe(1)
    })
  })

  // ==========================================================================
  // 10. INTEGRATION WITH WORKFLOW CONTEXT
  // ==========================================================================

  describe('Integration with Workflow Context', () => {
    it('$.waitFor creates pending wait via manager', async () => {
      // This tests the integration point where the workflow DSL connects to the manager
      const workflowContext = {
        waitForEventManager: manager,
        waitFor: async (eventName: string, options: WaitForEventOptions = {}) => {
          return manager.waitForEvent(eventName, options)
        },
      }

      const waitPromise = workflowContext.waitFor('approval', { timeout: '7 days' })

      // Verify wait was registered
      const pending = await manager.listPendingWaits()
      expect(pending).toHaveLength(1)
      expect(pending[0].eventName).toBe('approval')

      // Resolve it
      await manager.deliverEvent(null, 'approval', { approved: true })

      const result = await waitPromise
      expect(result.approved).toBe(true)
    })

    it('workflow can await on $.waitFor directly', async () => {
      // Simulate workflow execution pattern
      async function runWorkflow() {
        const expense = { id: 'exp-1', amount: 5000 }

        // This would trigger hibernation in real DO
        const decision = await manager.waitForEvent('manager-approval', {
          timeout: '7 days',
          type: 'expense-decision',
        })

        return {
          status: decision.approved ? 'approved' : 'rejected',
          by: decision.approver,
        }
      }

      const workflowPromise = runWorkflow()

      // Simulate external event delivery (e.g., from Slack action)
      setTimeout(() => {
        manager.deliverEvent(null, 'manager-approval', {
          approved: true,
          approver: 'manager@company.com',
        })
      }, 100)

      vi.advanceTimersByTime(100)

      const result = await workflowPromise

      expect(result.status).toBe('approved')
      expect(result.by).toBe('manager@company.com')
    })
  })
})
