/**
 * WaitForEvent Graph Relationship Tests
 *
 * Tests for the graph-based WaitForEvent implementation using verb form state encoding.
 *
 * TDD Approach:
 * - Tests verify verb form state transitions (waitFor -> waitingFor -> waitedFor)
 * - No mocks - uses real in-memory store
 * - Verifies relationship-based queries
 *
 * @see dotdo-hg8t8 - [REFACTOR] Migrate WaitForEventManager to use graph relationships
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  // Operations
  createWaitForEvent,
  startWaiting,
  deliverEvent,
  deliverEventByCorrelation,
  cancelWait,
  timeoutWait,
  // Queries
  getWait,
  getWaitState,
  hasWaitError,
  queryPendingWaits,
  queryActiveWaits,
  queryIncompleteWaits,
  queryWaitsByInstance,
  findExpiredWaits,
  // Timeout handling
  checkWaitTimeout,
  getNextWaitTimeout,
  // Statistics
  getWaitStats,
  // Errors
  WaitTimeoutError,
  WaitCancelledError,
  WaitEventMismatchError,
  // Types
  type WaitForEventRelationship,
  type WaitResult,
} from './wait-for-event'

// ============================================================================
// TEST DATABASE (per-test isolation)
// ============================================================================

function createTestDb(): object {
  return {} // Empty object provides per-test isolation via WeakMap
}

// ============================================================================
// VERB FORM STATE ENCODING TESTS
// ============================================================================

describe('WaitForEvent Graph Relationships', () => {
  let db: object

  beforeEach(() => {
    db = createTestDb()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-13T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ==========================================================================
  // 1. VERB FORM STATE ENCODING
  // ==========================================================================

  describe('Verb Form State Encoding', () => {
    it("creates wait with 'waitFor' action form (pending state)", async () => {
      const wait = await createWaitForEvent(db, 'instance-1', 'approval', {})

      expect(wait.verb).toBe('waitFor')
      expect(getWaitState(wait)).toBe('pending')
    })

    it("transitions to 'waitingFor' activity form (in-progress state)", async () => {
      const created = await createWaitForEvent(db, 'instance-1', 'approval', {})
      const started = await startWaiting(db, created.id)

      expect(started.verb).toBe('waitingFor')
      expect(getWaitState(started)).toBe('in_progress')
    })

    it("transitions to 'waitedFor' event form (completed state) on delivery", async () => {
      const created = await createWaitForEvent(db, 'instance-1', 'approval', {})
      await startWaiting(db, created.id)
      await deliverEvent(db, created.id, 'approval', { approved: true })

      const completed = await getWait(db, created.id)
      expect(completed?.verb).toBe('waitedFor')
      expect(getWaitState(completed!)).toBe('completed')
    })

    it('sets to field when completed (relationship target)', async () => {
      const created = await createWaitForEvent(db, 'instance-1', 'approval', {})
      expect(created.to).toBeNull()

      await deliverEvent(db, created.id, 'approval', { approved: true })

      const completed = await getWait(db, created.id)
      expect(completed?.to).toBe('approval')
    })

    it('stores payload in data when resolved', async () => {
      const created = await createWaitForEvent(db, 'instance-1', 'approval', {})
      const payload = { approved: true, approver: 'alice@example.com' }

      await deliverEvent(db, created.id, 'approval', payload)

      const completed = await getWait(db, created.id)
      expect(completed?.data.payload).toEqual(payload)
    })
  })

  // ==========================================================================
  // 2. BASIC WAIT FUNCTIONALITY
  // ==========================================================================

  describe('Basic Wait Functionality', () => {
    it('creates a wait relationship for a named event', async () => {
      const wait = await createWaitForEvent(db, 'instance-1', 'manager-approval', {})

      expect(wait.id).toBeDefined()
      expect(wait.from).toBe('instance-1')
      expect(wait.data.eventName).toBe('manager-approval')
    })

    it('generates unique wait IDs', async () => {
      const ids = new Set<string>()

      for (let i = 0; i < 100; i++) {
        const wait = await createWaitForEvent(db, `instance-${i}`, `event-${i}`, {})
        ids.add(wait.id)
      }

      expect(ids.size).toBe(100)
    })

    it('stores creation timestamp', async () => {
      const wait = await createWaitForEvent(db, 'instance-1', 'event', {})

      expect(wait.createdAt).toBe(Date.now())
    })

    it('resolves wait when matching event is delivered', async () => {
      const wait = await createWaitForEvent(db, 'instance-1', 'approval', {})

      const result = await deliverEvent(db, wait.id, 'approval', {
        approved: true,
        approver: 'john@example.com',
      })

      expect(result.resolved).toBe(true)
      expect(result.payload).toEqual({
        approved: true,
        approver: 'john@example.com',
      })
    })

    it('can deliver event without specifying wait ID', async () => {
      await createWaitForEvent(db, 'instance-1', 'my-event', {})

      const result = await deliverEvent(db, null, 'my-event', { data: 'value' })

      expect(result.resolved).toBe(true)
      expect(result.payload).toEqual({ data: 'value' })
    })

    it('returns not-found when no matching wait exists', async () => {
      const result = await deliverEvent(db, null, 'unknown-event', {})

      expect(result.resolved).toBe(false)
      expect(result.reason).toBe('no-matching-wait')
    })

    it('tracks wait duration on resolution', async () => {
      const wait = await createWaitForEvent(db, 'instance-1', 'event', {})

      // Advance time
      vi.advanceTimersByTime(5000)

      const result = await deliverEvent(db, wait.id, 'event', {})

      expect(result.duration).toBeGreaterThanOrEqual(5000)
    })
  })

  // ==========================================================================
  // 3. TIMEOUT HANDLING
  // ==========================================================================

  describe('Timeout Handling', () => {
    it('supports timeout option with duration string', async () => {
      const wait = await createWaitForEvent(db, 'instance-1', 'approval', {
        timeout: '7 days',
      })

      expect(wait.data.timeout).toBe(7 * 24 * 60 * 60 * 1000)
      expect(wait.data.expiresAt).toBeCloseTo(Date.now() + 7 * 24 * 60 * 60 * 1000, -3)
    })

    it('supports timeout option with milliseconds', async () => {
      const wait = await createWaitForEvent(db, 'instance-1', 'quick-response', {
        timeout: 5000,
      })

      expect(wait.data.timeout).toBe(5000)
      expect(wait.data.expiresAt).toBeCloseTo(Date.now() + 5000, -3)
    })

    it('supports no timeout (indefinite wait)', async () => {
      const wait = await createWaitForEvent(db, 'instance-1', 'no-rush', {})

      expect(wait.data.timeout).toBeUndefined()
      expect(wait.data.expiresAt).toBeUndefined()
    })

    it('checkWaitTimeout returns correct status for expired wait', async () => {
      const wait = await createWaitForEvent(db, 'instance-1', 'event', {
        timeout: 1000,
      })

      // Before expiry
      let status = checkWaitTimeout(wait)
      expect(status.hasExpired).toBe(false)
      expect(status.timeRemaining).toBeCloseTo(1000, -2)

      // Advance past timeout
      vi.advanceTimersByTime(1500)

      status = checkWaitTimeout(wait)
      expect(status.hasExpired).toBe(true)
      expect(status.timeRemaining).toBeLessThan(0)
    })

    it('checkWaitTimeout returns infinity for no timeout', async () => {
      const wait = await createWaitForEvent(db, 'instance-1', 'event', {})

      const status = checkWaitTimeout(wait)

      expect(status.hasExpired).toBe(false)
      expect(status.timeRemaining).toBe(Number.MAX_SAFE_INTEGER)
      expect(status.expiresAt).toBeNull()
    })

    it('timeoutWait marks wait as timed out', async () => {
      const wait = await createWaitForEvent(db, 'instance-1', 'slow', {
        timeout: 100,
      })

      vi.advanceTimersByTime(150)

      const timedOut = await timeoutWait(db, wait.id)

      expect(timedOut?.verb).toBe('waitedFor')
      expect(timedOut?.data.error).toContain('Timed out')
      expect(hasWaitError(timedOut!)).toBe(true)
    })

    it('findExpiredWaits returns only expired incomplete waits', async () => {
      // Wait 1: expired
      await createWaitForEvent(db, 'instance-1', 'event-1', { timeout: 100 })
      // Wait 2: not expired
      await createWaitForEvent(db, 'instance-2', 'event-2', { timeout: 10000 })
      // Wait 3: no timeout
      await createWaitForEvent(db, 'instance-3', 'event-3', {})

      vi.advanceTimersByTime(500)

      const expired = await findExpiredWaits(db)

      expect(expired).toHaveLength(1)
      expect(expired[0].data.eventName).toBe('event-1')
    })

    it('getNextWaitTimeout returns earliest timeout', async () => {
      await createWaitForEvent(db, 'instance-1', 'event-1', { timeout: 5000 })
      await createWaitForEvent(db, 'instance-2', 'event-2', { timeout: 10000 })
      await createWaitForEvent(db, 'instance-3', 'event-3', { timeout: 3000 })

      const next = await getNextWaitTimeout(db)

      expect(next).toBe(Date.now() + 3000)
    })

    it('getNextWaitTimeout returns null when no timeouts', async () => {
      await createWaitForEvent(db, 'instance-1', 'event', {})

      const next = await getNextWaitTimeout(db)

      expect(next).toBeNull()
    })
  })

  // ==========================================================================
  // 4. CANCELLATION
  // ==========================================================================

  describe('Cancellation', () => {
    it('can cancel a pending wait', async () => {
      const wait = await createWaitForEvent(db, 'instance-1', 'event', {})

      const cancelled = await cancelWait(db, wait.id)

      expect(cancelled).toBe(true)

      const updated = await getWait(db, wait.id)
      expect(updated?.verb).toBe('waitedFor')
      expect(hasWaitError(updated!)).toBe(true)
    })

    it('cancelled wait has error message', async () => {
      const wait = await createWaitForEvent(db, 'instance-1', 'event', {})

      await cancelWait(db, wait.id, 'User cancelled')

      const updated = await getWait(db, wait.id)
      expect(updated?.data.error).toBe('Cancelled: User cancelled')
    })

    it('returns false when cancelling non-existent wait', async () => {
      const result = await cancelWait(db, 'non-existent-id')

      expect(result).toBe(false)
    })

    it('returns false when cancelling already completed wait', async () => {
      const wait = await createWaitForEvent(db, 'instance-1', 'event', {})
      await deliverEvent(db, wait.id, 'event', {})

      const result = await cancelWait(db, wait.id)

      expect(result).toBe(false)
    })

    it('cancelled wait tracks duration', async () => {
      const wait = await createWaitForEvent(db, 'instance-1', 'event', {})

      vi.advanceTimersByTime(3000)
      await cancelWait(db, wait.id)

      const updated = await getWait(db, wait.id)
      expect(updated?.data.duration).toBeGreaterThanOrEqual(3000)
    })
  })

  // ==========================================================================
  // 5. CORRELATION IDs
  // ==========================================================================

  describe('Correlation IDs', () => {
    it('supports correlation ID for targeted event delivery', async () => {
      await createWaitForEvent(db, 'instance-1', 'approval', { correlationId: 'request-123' })
      await createWaitForEvent(db, 'instance-2', 'approval', { correlationId: 'request-456' })

      const result = await deliverEventByCorrelation(db, 'approval', 'request-123', {
        approved: true,
      })

      expect(result.resolved).toBe(true)

      // Other wait should still be pending
      const pending = await queryPendingWaits(db)
      expect(pending).toHaveLength(1)
      expect(pending[0].options.correlationId).toBe('request-456')
    })

    it('correlation ID is included in wait data', async () => {
      const wait = await createWaitForEvent(db, 'instance-1', 'event', {
        correlationId: 'my-correlation',
      })

      expect(wait.data.correlationId).toBe('my-correlation')
    })

    it('deliverEventByCorrelation returns not-found for wrong correlation', async () => {
      await createWaitForEvent(db, 'instance-1', 'approval', { correlationId: 'request-123' })

      const result = await deliverEventByCorrelation(db, 'approval', 'wrong-id', {})

      expect(result.resolved).toBe(false)
      expect(result.reason).toBe('no-matching-wait')
    })
  })

  // ==========================================================================
  // 6. EVENT NAME VALIDATION
  // ==========================================================================

  describe('Event Name Validation', () => {
    it('throws WaitEventMismatchError for wrong event name', async () => {
      const wait = await createWaitForEvent(db, 'instance-1', 'expected-event', {})

      await expect(deliverEvent(db, wait.id, 'wrong-event', {})).rejects.toThrow(
        WaitEventMismatchError
      )
    })

    it('event mismatch error includes details', async () => {
      const wait = await createWaitForEvent(db, 'instance-1', 'approval', {})

      try {
        await deliverEvent(db, wait.id, 'rejection', {})
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(WaitEventMismatchError)
        expect((error as WaitEventMismatchError).expected).toBe('approval')
        expect((error as WaitEventMismatchError).received).toBe('rejection')
      }
    })
  })

  // ==========================================================================
  // 7. EVENT FILTERING
  // ==========================================================================

  describe('Event Filtering', () => {
    it('supports filter function to match events', async () => {
      const wait = await createWaitForEvent(db, 'instance-1', 'order-update', {
        filter: (payload: unknown) => (payload as { status: string }).status === 'shipped',
      })

      // Non-matching event
      const result1 = await deliverEvent(db, wait.id, 'order-update', { status: 'processing' })
      expect(result1.resolved).toBe(false)
      expect(result1.reason).toBe('filter-mismatch')

      // Matching event
      const result2 = await deliverEvent(db, wait.id, 'order-update', {
        status: 'shipped',
        carrier: 'FedEx',
      })
      expect(result2.resolved).toBe(true)
    })

    it('supports property-based filter shorthand', async () => {
      const wait = await createWaitForEvent(db, 'instance-1', 'notification', {
        filter: { type: 'approval', priority: 'high' },
      })

      // Non-matching
      const result1 = await deliverEvent(db, wait.id, 'notification', { type: 'info' })
      expect(result1.resolved).toBe(false)

      // Matching
      const result2 = await deliverEvent(db, wait.id, 'notification', {
        type: 'approval',
        priority: 'high',
        message: 'Approved!',
      })
      expect(result2.resolved).toBe(true)
    })

    it('filter errors are logged and event is skipped', async () => {
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const wait = await createWaitForEvent(db, 'instance-1', 'event', {
        filter: () => {
          throw new Error('Filter error')
        },
      })

      const result = await deliverEvent(db, wait.id, 'event', { data: 'test' })

      expect(result.resolved).toBe(false)
      expect(result.reason).toBe('filter-mismatch')
      expect(consoleWarn).toHaveBeenCalled()

      consoleWarn.mockRestore()
    })
  })

  // ==========================================================================
  // 8. QUERY OPERATIONS
  // ==========================================================================

  describe('Query Operations', () => {
    describe('queryPendingWaits', () => {
      it('returns only pending waits (action form)', async () => {
        const wait1 = await createWaitForEvent(db, 'instance-1', 'event-1', {})
        await createWaitForEvent(db, 'instance-2', 'event-2', {})
        const wait3 = await createWaitForEvent(db, 'instance-3', 'event-3', {})

        // Complete one
        await deliverEvent(db, wait1.id, 'event-1', {})
        // Start one (activity form)
        await startWaiting(db, wait3.id)

        const pending = await queryPendingWaits(db)

        expect(pending).toHaveLength(1)
        expect(pending[0].eventName).toBe('event-2')
      })

      it('can filter by instanceId', async () => {
        await createWaitForEvent(db, 'instance-1', 'event-1', {})
        await createWaitForEvent(db, 'instance-1', 'event-2', {})
        await createWaitForEvent(db, 'instance-2', 'event-3', {})

        const pending = await queryPendingWaits(db, { instanceId: 'instance-1' })

        expect(pending).toHaveLength(2)
        expect(pending.every((w) => w.instanceId === 'instance-1')).toBe(true)
      })

      it('can filter by eventName', async () => {
        await createWaitForEvent(db, 'instance-1', 'approval', {})
        await createWaitForEvent(db, 'instance-2', 'approval', {})
        await createWaitForEvent(db, 'instance-3', 'rejection', {})

        const pending = await queryPendingWaits(db, { eventName: 'approval' })

        expect(pending).toHaveLength(2)
        expect(pending.every((w) => w.eventName === 'approval')).toBe(true)
      })

      it('sorts by urgency (expired first, then by time remaining)', async () => {
        await createWaitForEvent(db, 'instance-1', 'event-1', { timeout: 5000 })
        await createWaitForEvent(db, 'instance-2', 'event-2', { timeout: 100 })
        await createWaitForEvent(db, 'instance-3', 'event-3', { timeout: 3000 })

        vi.advanceTimersByTime(500) // event-2 is now expired

        const pending = await queryPendingWaits(db)

        expect(pending[0].eventName).toBe('event-2') // expired
        expect(pending[0].isExpired).toBe(true)
        expect(pending[1].eventName).toBe('event-3') // 2500ms remaining
        expect(pending[2].eventName).toBe('event-1') // 4500ms remaining
      })

      it('respects limit', async () => {
        for (let i = 0; i < 10; i++) {
          await createWaitForEvent(db, `instance-${i}`, `event-${i}`, {})
        }

        const pending = await queryPendingWaits(db, { limit: 3 })

        expect(pending).toHaveLength(3)
      })
    })

    describe('queryActiveWaits', () => {
      it('returns only active waits (activity form)', async () => {
        const wait1 = await createWaitForEvent(db, 'instance-1', 'event-1', {})
        const wait2 = await createWaitForEvent(db, 'instance-2', 'event-2', {})
        await createWaitForEvent(db, 'instance-3', 'event-3', {})

        await startWaiting(db, wait1.id)
        await startWaiting(db, wait2.id)

        const active = await queryActiveWaits(db)

        expect(active).toHaveLength(2)
        expect(active.every((w) => w.verb === 'waitingFor')).toBe(true)
      })
    })

    describe('queryIncompleteWaits', () => {
      it('returns pending and active waits', async () => {
        const wait1 = await createWaitForEvent(db, 'instance-1', 'event-1', {})
        const wait2 = await createWaitForEvent(db, 'instance-2', 'event-2', {})
        const wait3 = await createWaitForEvent(db, 'instance-3', 'event-3', {})

        await startWaiting(db, wait1.id)
        await deliverEvent(db, wait2.id, 'event-2', {})

        const incomplete = await queryIncompleteWaits(db)

        expect(incomplete).toHaveLength(2)
        expect(incomplete.map((w) => w.data.eventName).sort()).toEqual(['event-1', 'event-3'])
      })
    })

    describe('queryWaitsByInstance', () => {
      it('returns all waits for an instance', async () => {
        await createWaitForEvent(db, 'instance-1', 'event-1', {})
        const wait2 = await createWaitForEvent(db, 'instance-1', 'event-2', {})
        await createWaitForEvent(db, 'instance-2', 'event-3', {})

        await deliverEvent(db, wait2.id, 'event-2', {})

        const waits = await queryWaitsByInstance(db, 'instance-1')

        expect(waits).toHaveLength(2)
        expect(waits.every((w) => w.from === 'instance-1')).toBe(true)
      })

      it('sorts by creation time (newest first)', async () => {
        const wait1 = await createWaitForEvent(db, 'instance-1', 'event-1', {})
        vi.advanceTimersByTime(1000)
        const wait2 = await createWaitForEvent(db, 'instance-1', 'event-2', {})
        vi.advanceTimersByTime(1000)
        const wait3 = await createWaitForEvent(db, 'instance-1', 'event-3', {})

        const waits = await queryWaitsByInstance(db, 'instance-1')

        expect(waits[0].data.eventName).toBe('event-3')
        expect(waits[1].data.eventName).toBe('event-2')
        expect(waits[2].data.eventName).toBe('event-1')
      })
    })
  })

  // ==========================================================================
  // 9. MULTIPLE WAITS
  // ==========================================================================

  describe('Multiple Waits', () => {
    it('can have multiple pending waits for different events', async () => {
      await createWaitForEvent(db, 'instance-1', 'event-a', {})
      await createWaitForEvent(db, 'instance-1', 'event-b', {})
      await createWaitForEvent(db, 'instance-1', 'event-c', {})

      const pending = await queryPendingWaits(db)

      expect(pending).toHaveLength(3)
      expect(pending.map((w) => w.eventName).sort()).toEqual(['event-a', 'event-b', 'event-c'])
    })

    it('can wait for same event name from multiple instances', async () => {
      const wait1 = await createWaitForEvent(db, 'instance-1', 'approval', {
        correlationId: 'approver-1',
      })
      const wait2 = await createWaitForEvent(db, 'instance-2', 'approval', {
        correlationId: 'approver-2',
      })

      // Deliver to specific wait via correlation
      await deliverEventByCorrelation(db, 'approval', 'approver-1', { approved: true })

      // Second wait should still be pending
      const pending = await queryPendingWaits(db)
      expect(pending).toHaveLength(1)
      expect(pending[0].options.correlationId).toBe('approver-2')
    })
  })

  // ==========================================================================
  // 10. STATISTICS
  // ==========================================================================

  describe('Statistics', () => {
    it('provides wait statistics', async () => {
      const wait1 = await createWaitForEvent(db, 'instance-1', 'event-1', { timeout: 5000 })
      await createWaitForEvent(db, 'instance-2', 'event-2', {})
      const wait3 = await createWaitForEvent(db, 'instance-3', 'event-3', { timeout: 100 })
      const wait4 = await createWaitForEvent(db, 'instance-4', 'event-4', {})

      // Start one
      await startWaiting(db, wait1.id)
      // Complete one
      await deliverEvent(db, wait4.id, 'event-4', {})

      // Advance to expire wait3
      vi.advanceTimersByTime(500)

      const stats = await getWaitStats(db)

      expect(stats.pendingCount).toBe(2) // event-2, event-3
      expect(stats.activeCount).toBe(1) // event-1
      expect(stats.completedCount).toBe(1) // event-4
      expect(stats.withTimeout).toBe(2) // event-1, event-3
      expect(stats.withoutTimeout).toBe(1) // event-2
      expect(stats.expiredCount).toBe(1) // event-3
    })
  })

  // ==========================================================================
  // 11. STATE TRANSITIONS
  // ==========================================================================

  describe('State Transitions', () => {
    it('cannot start an already started wait', async () => {
      const wait = await createWaitForEvent(db, 'instance-1', 'event', {})
      await startWaiting(db, wait.id)

      await expect(startWaiting(db, wait.id)).rejects.toThrow()
    })

    it('can deliver to pending wait (skip activity state)', async () => {
      const wait = await createWaitForEvent(db, 'instance-1', 'event', {})

      // Direct delivery without starting
      const result = await deliverEvent(db, wait.id, 'event', { data: 'value' })

      expect(result.resolved).toBe(true)

      const completed = await getWait(db, wait.id)
      expect(completed?.verb).toBe('waitedFor')
    })

    it('cannot deliver to completed wait', async () => {
      const wait = await createWaitForEvent(db, 'instance-1', 'event', {})
      await deliverEvent(db, wait.id, 'event', { first: true })

      const result = await deliverEvent(db, wait.id, 'event', { second: true })

      expect(result.resolved).toBe(false)
      expect(result.reason).toBe('no-matching-wait')
    })

    it('cannot timeout completed wait', async () => {
      const wait = await createWaitForEvent(db, 'instance-1', 'event', { timeout: 100 })
      await deliverEvent(db, wait.id, 'event', {})

      const result = await timeoutWait(db, wait.id)

      expect(result).toBeNull()
    })
  })

  // ==========================================================================
  // 12. HISTORY PRESERVATION
  // ==========================================================================

  describe('History Preservation', () => {
    it('preserves wait after resolution (not deleted)', async () => {
      const wait = await createWaitForEvent(db, 'instance-1', 'event', {})
      await deliverEvent(db, wait.id, 'event', { data: 'value' })

      const preserved = await getWait(db, wait.id)

      expect(preserved).not.toBeNull()
      expect(preserved?.verb).toBe('waitedFor')
    })

    it('preserves wait after cancellation (for audit)', async () => {
      const wait = await createWaitForEvent(db, 'instance-1', 'event', {})
      await cancelWait(db, wait.id, 'User cancelled')

      const preserved = await getWait(db, wait.id)

      expect(preserved).not.toBeNull()
      expect(preserved?.data.error).toContain('cancelled')
    })

    it('preserves wait after timeout (for audit)', async () => {
      const wait = await createWaitForEvent(db, 'instance-1', 'event', { timeout: 100 })
      vi.advanceTimersByTime(150)
      await timeoutWait(db, wait.id)

      const preserved = await getWait(db, wait.id)

      expect(preserved).not.toBeNull()
      expect(preserved?.data.error).toContain('Timed out')
    })
  })
})
