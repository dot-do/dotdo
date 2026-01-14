/**
 * SyncStatus Tests
 *
 * TDD test suite for sync status tracking and progress reporting.
 *
 * The SyncStatus class provides real-time tracking of sync operations,
 * including progress updates, state transitions, and event emission.
 *
 * Test Coverage:
 * - [x] SyncStatus initializes with pending state
 * - [x] SyncStatus transitions through valid states only
 * - [x] SyncProgress updates atomically
 * - [x] SyncStatus persists across restarts
 * - [x] SyncStatus emits events on state changes
 *
 * @module db/primitives/sync/tests/sync-status.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  SyncStatus,
  SyncProgress,
  SyncError,
  SyncStatusState,
  createSyncStatus,
  type SyncStatusEvents,
} from '../sync-status'

// =============================================================================
// TEST HELPERS
// =============================================================================

function createTestProgress(overrides: Partial<SyncProgress> = {}): SyncProgress {
  return {
    totalRecords: 0,
    processedRecords: 0,
    addedCount: 0,
    modifiedCount: 0,
    deletedCount: 0,
    failedCount: 0,
    ...overrides,
  }
}

// =============================================================================
// SYNC STATUS INITIALIZATION TESTS
// =============================================================================

describe('SyncStatus', () => {
  describe('initialization', () => {
    it('initializes with pending state', () => {
      const status = new SyncStatus({
        syncId: 'sync-123',
        planId: 'plan-456',
      })

      expect(status.syncId).toBe('sync-123')
      expect(status.planId).toBe('plan-456')
      expect(status.status).toBe('pending')
      expect(status.startedAt).toBeInstanceOf(Date)
      expect(status.completedAt).toBeUndefined()
      expect(status.error).toBeUndefined()
    })

    it('initializes with zero progress counters', () => {
      const status = new SyncStatus({
        syncId: 'sync-123',
        planId: 'plan-456',
      })

      const progress = status.progress
      expect(progress.totalRecords).toBe(0)
      expect(progress.processedRecords).toBe(0)
      expect(progress.addedCount).toBe(0)
      expect(progress.modifiedCount).toBe(0)
      expect(progress.deletedCount).toBe(0)
      expect(progress.failedCount).toBe(0)
    })

    it('accepts initial total records count', () => {
      const status = new SyncStatus({
        syncId: 'sync-123',
        planId: 'plan-456',
        totalRecords: 1000,
      })

      expect(status.progress.totalRecords).toBe(1000)
    })

    it('generates unique syncId when not provided', () => {
      const status1 = createSyncStatus({ planId: 'plan-456' })
      const status2 = createSyncStatus({ planId: 'plan-456' })

      expect(status1.syncId).toBeDefined()
      expect(status2.syncId).toBeDefined()
      expect(status1.syncId).not.toBe(status2.syncId)
    })
  })

  // =============================================================================
  // STATE TRANSITION TESTS
  // =============================================================================

  describe('state transitions', () => {
    let status: SyncStatus

    beforeEach(() => {
      status = new SyncStatus({
        syncId: 'sync-123',
        planId: 'plan-456',
      })
    })

    it('transitions from pending to running', () => {
      status.start()

      expect(status.status).toBe('running')
    })

    it('transitions from running to completed', () => {
      status.start()
      status.complete()

      expect(status.status).toBe('completed')
      expect(status.completedAt).toBeInstanceOf(Date)
    })

    it('transitions from running to failed', () => {
      status.start()
      status.fail({ code: 'ERR_NETWORK', message: 'Connection timeout' })

      expect(status.status).toBe('failed')
      expect(status.completedAt).toBeInstanceOf(Date)
      expect(status.error).toEqual({
        code: 'ERR_NETWORK',
        message: 'Connection timeout',
      })
    })

    it('transitions from pending to cancelled', () => {
      status.cancel()

      expect(status.status).toBe('cancelled')
      expect(status.completedAt).toBeInstanceOf(Date)
    })

    it('transitions from running to cancelled', () => {
      status.start()
      status.cancel()

      expect(status.status).toBe('cancelled')
      expect(status.completedAt).toBeInstanceOf(Date)
    })

    it('rejects invalid transition from pending to completed', () => {
      expect(() => status.complete()).toThrow('Invalid state transition')
    })

    it('rejects invalid transition from completed to running', () => {
      status.start()
      status.complete()

      expect(() => status.start()).toThrow('Invalid state transition')
    })

    it('rejects invalid transition from failed to running', () => {
      status.start()
      status.fail({ code: 'ERR_FAIL', message: 'Failed' })

      expect(() => status.start()).toThrow('Invalid state transition')
    })

    it('rejects invalid transition from cancelled to running', () => {
      status.cancel()

      expect(() => status.start()).toThrow('Invalid state transition')
    })

    it('allows only valid state transitions', () => {
      // Valid transitions:
      // pending -> running, cancelled
      // running -> completed, failed, cancelled
      // completed, failed, cancelled are terminal states

      const validTransitions: Record<SyncStatusState, SyncStatusState[]> = {
        pending: ['running', 'cancelled'],
        running: ['completed', 'failed', 'cancelled'],
        completed: [],
        failed: [],
        cancelled: [],
      }

      // Test each valid transition
      for (const [from, validTargets] of Object.entries(validTransitions)) {
        for (const to of validTargets) {
          const testStatus = new SyncStatus({ syncId: 'test', planId: 'test' })

          // Get to the 'from' state
          if (from === 'running') {
            testStatus.start()
          }

          // Attempt transition to 'to' state
          if (to === 'running') {
            testStatus.start()
          } else if (to === 'completed') {
            testStatus.complete()
          } else if (to === 'failed') {
            testStatus.fail({ code: 'ERR', message: 'Error' })
          } else if (to === 'cancelled') {
            testStatus.cancel()
          }

          expect(testStatus.status).toBe(to)
        }
      }
    })
  })

  // =============================================================================
  // PROGRESS UPDATE TESTS
  // =============================================================================

  describe('progress updates', () => {
    let status: SyncStatus

    beforeEach(() => {
      status = new SyncStatus({
        syncId: 'sync-123',
        planId: 'plan-456',
        totalRecords: 100,
      })
      status.start()
    })

    it('updates progress atomically', () => {
      status.updateProgress({
        processedRecords: 10,
        addedCount: 5,
        modifiedCount: 3,
        deletedCount: 2,
        failedCount: 0,
      })

      const progress = status.progress
      expect(progress.processedRecords).toBe(10)
      expect(progress.addedCount).toBe(5)
      expect(progress.modifiedCount).toBe(3)
      expect(progress.deletedCount).toBe(2)
      expect(progress.failedCount).toBe(0)
    })

    it('increments progress counters', () => {
      status.incrementProgress('addedCount', 5)
      status.incrementProgress('modifiedCount', 3)
      status.incrementProgress('deletedCount', 2)
      status.incrementProgress('processedRecords', 10)

      const progress = status.progress
      expect(progress.addedCount).toBe(5)
      expect(progress.modifiedCount).toBe(3)
      expect(progress.deletedCount).toBe(2)
      expect(progress.processedRecords).toBe(10)
    })

    it('calculates progress percentage', () => {
      status.updateProgress({ processedRecords: 25 })
      expect(status.progressPercentage).toBe(25)

      status.updateProgress({ processedRecords: 50 })
      expect(status.progressPercentage).toBe(50)

      status.updateProgress({ processedRecords: 100 })
      expect(status.progressPercentage).toBe(100)
    })

    it('returns 0% progress when no total records', () => {
      const emptyStatus = new SyncStatus({
        syncId: 'sync-empty',
        planId: 'plan-456',
        totalRecords: 0,
      })

      expect(emptyStatus.progressPercentage).toBe(0)
    })

    it('sets total records after initialization', () => {
      status.setTotalRecords(200)

      expect(status.progress.totalRecords).toBe(200)
    })

    it('records a processed item with result', () => {
      status.recordProcessed('added')
      status.recordProcessed('modified')
      status.recordProcessed('deleted')
      status.recordProcessed('failed')

      const progress = status.progress
      expect(progress.processedRecords).toBe(4)
      expect(progress.addedCount).toBe(1)
      expect(progress.modifiedCount).toBe(1)
      expect(progress.deletedCount).toBe(1)
      expect(progress.failedCount).toBe(1)
    })

    it('records batch of processed items', () => {
      status.recordBatch({
        added: 10,
        modified: 5,
        deleted: 3,
        failed: 2,
      })

      const progress = status.progress
      expect(progress.processedRecords).toBe(20)
      expect(progress.addedCount).toBe(10)
      expect(progress.modifiedCount).toBe(5)
      expect(progress.deletedCount).toBe(3)
      expect(progress.failedCount).toBe(2)
    })

    it('prevents progress updates when not running', () => {
      const pendingStatus = new SyncStatus({
        syncId: 'sync-pending',
        planId: 'plan-456',
      })

      expect(() => pendingStatus.updateProgress({ processedRecords: 10 }))
        .toThrow('Cannot update progress when sync is not running')
    })

    it('prevents progress updates when completed', () => {
      status.complete()

      expect(() => status.updateProgress({ processedRecords: 10 }))
        .toThrow('Cannot update progress when sync is not running')
    })
  })

  // =============================================================================
  // PERSISTENCE TESTS
  // =============================================================================

  describe('persistence', () => {
    it('serializes to JSON', () => {
      const status = new SyncStatus({
        syncId: 'sync-123',
        planId: 'plan-456',
        totalRecords: 100,
      })
      status.start()
      status.updateProgress({
        processedRecords: 50,
        addedCount: 30,
        modifiedCount: 15,
        deletedCount: 5,
        failedCount: 0,
      })

      const json = status.toJSON()

      expect(json).toMatchObject({
        syncId: 'sync-123',
        planId: 'plan-456',
        status: 'running',
        progress: {
          totalRecords: 100,
          processedRecords: 50,
          addedCount: 30,
          modifiedCount: 15,
          deletedCount: 5,
          failedCount: 0,
        },
      })
      expect(json.startedAt).toBeDefined()
    })

    it('deserializes from JSON', () => {
      const json = {
        syncId: 'sync-123',
        planId: 'plan-456',
        status: 'running' as const,
        startedAt: new Date('2026-01-13T10:00:00Z').toISOString(),
        progress: {
          totalRecords: 100,
          processedRecords: 50,
          addedCount: 30,
          modifiedCount: 15,
          deletedCount: 5,
          failedCount: 0,
        },
      }

      const status = SyncStatus.fromJSON(json)

      expect(status.syncId).toBe('sync-123')
      expect(status.planId).toBe('plan-456')
      expect(status.status).toBe('running')
      expect(status.startedAt).toEqual(new Date('2026-01-13T10:00:00Z'))
      expect(status.progress.processedRecords).toBe(50)
    })

    it('persists error state', () => {
      const status = new SyncStatus({
        syncId: 'sync-123',
        planId: 'plan-456',
      })
      status.start()
      status.fail({ code: 'ERR_TIMEOUT', message: 'Request timed out', details: { attempt: 3 } })

      const json = status.toJSON()
      const restored = SyncStatus.fromJSON(json)

      expect(restored.status).toBe('failed')
      expect(restored.error).toEqual({
        code: 'ERR_TIMEOUT',
        message: 'Request timed out',
        details: { attempt: 3 },
      })
    })

    it('persists completedAt timestamp', () => {
      const status = new SyncStatus({
        syncId: 'sync-123',
        planId: 'plan-456',
      })
      status.start()
      status.complete()

      const json = status.toJSON()
      const restored = SyncStatus.fromJSON(json)

      expect(restored.completedAt).toBeInstanceOf(Date)
      expect(restored.completedAt?.toISOString()).toBe(json.completedAt)
    })

    it('restores and continues progress updates', () => {
      const json = {
        syncId: 'sync-123',
        planId: 'plan-456',
        status: 'running' as const,
        startedAt: new Date().toISOString(),
        progress: {
          totalRecords: 100,
          processedRecords: 50,
          addedCount: 30,
          modifiedCount: 15,
          deletedCount: 5,
          failedCount: 0,
        },
      }

      const status = SyncStatus.fromJSON(json)
      status.updateProgress({ processedRecords: 75, addedCount: 45 })

      expect(status.progress.processedRecords).toBe(75)
      expect(status.progress.addedCount).toBe(45)
    })
  })

  // =============================================================================
  // EVENT EMISSION TESTS
  // =============================================================================

  describe('event emission', () => {
    let status: SyncStatus

    beforeEach(() => {
      status = new SyncStatus({
        syncId: 'sync-123',
        planId: 'plan-456',
        totalRecords: 100,
      })
    })

    it('emits started event on start', () => {
      const handler = vi.fn()
      status.on('started', handler)

      status.start()

      expect(handler).toHaveBeenCalledOnce()
      expect(handler).toHaveBeenCalledWith({
        syncId: 'sync-123',
        planId: 'plan-456',
        startedAt: expect.any(Date),
      })
    })

    it('emits completed event on completion', () => {
      const handler = vi.fn()
      status.on('completed', handler)
      status.start()

      status.complete()

      expect(handler).toHaveBeenCalledOnce()
      expect(handler).toHaveBeenCalledWith({
        syncId: 'sync-123',
        planId: 'plan-456',
        completedAt: expect.any(Date),
        progress: expect.any(Object),
      })
    })

    it('emits failed event on failure', () => {
      const handler = vi.fn()
      status.on('failed', handler)
      status.start()

      const error = { code: 'ERR_NETWORK', message: 'Connection lost' }
      status.fail(error)

      expect(handler).toHaveBeenCalledOnce()
      expect(handler).toHaveBeenCalledWith({
        syncId: 'sync-123',
        planId: 'plan-456',
        error,
        completedAt: expect.any(Date),
      })
    })

    it('emits cancelled event on cancellation', () => {
      const handler = vi.fn()
      status.on('cancelled', handler)

      status.cancel()

      expect(handler).toHaveBeenCalledOnce()
      expect(handler).toHaveBeenCalledWith({
        syncId: 'sync-123',
        planId: 'plan-456',
        completedAt: expect.any(Date),
      })
    })

    it('emits progress event on progress update', () => {
      const handler = vi.fn()
      status.on('progress', handler)
      status.start()

      status.updateProgress({ processedRecords: 25 })

      expect(handler).toHaveBeenCalledOnce()
      expect(handler).toHaveBeenCalledWith({
        syncId: 'sync-123',
        progress: expect.objectContaining({ processedRecords: 25 }),
        percentage: 25,
      })
    })

    it('emits stateChange event on any state transition', () => {
      const handler = vi.fn()
      status.on('stateChange', handler)

      status.start()
      status.complete()

      expect(handler).toHaveBeenCalledTimes(2)
      expect(handler).toHaveBeenNthCalledWith(1, {
        syncId: 'sync-123',
        previousState: 'pending',
        currentState: 'running',
      })
      expect(handler).toHaveBeenNthCalledWith(2, {
        syncId: 'sync-123',
        previousState: 'running',
        currentState: 'completed',
      })
    })

    it('supports once() for one-time event handlers', () => {
      const handler = vi.fn()
      status.once('progress', handler)
      status.start()

      status.updateProgress({ processedRecords: 25 })
      status.updateProgress({ processedRecords: 50 })

      expect(handler).toHaveBeenCalledOnce()
    })

    it('supports off() to remove event handlers', () => {
      const handler = vi.fn()
      status.on('progress', handler)
      status.off('progress', handler)
      status.start()

      status.updateProgress({ processedRecords: 25 })

      expect(handler).not.toHaveBeenCalled()
    })

    it('supports removeAllListeners()', () => {
      const startedHandler = vi.fn()
      const progressHandler = vi.fn()
      status.on('started', startedHandler)
      status.on('progress', progressHandler)

      status.removeAllListeners()
      status.start()
      status.updateProgress({ processedRecords: 25 })

      expect(startedHandler).not.toHaveBeenCalled()
      expect(progressHandler).not.toHaveBeenCalled()
    })
  })

  // =============================================================================
  // SYNC ERROR TESTS
  // =============================================================================

  describe('error handling', () => {
    it('stores error with code and message', () => {
      const status = new SyncStatus({
        syncId: 'sync-123',
        planId: 'plan-456',
      })
      status.start()

      status.fail({
        code: 'ERR_RATE_LIMIT',
        message: 'Rate limit exceeded',
      })

      expect(status.error).toEqual({
        code: 'ERR_RATE_LIMIT',
        message: 'Rate limit exceeded',
      })
    })

    it('stores error with additional details', () => {
      const status = new SyncStatus({
        syncId: 'sync-123',
        planId: 'plan-456',
      })
      status.start()

      status.fail({
        code: 'ERR_BATCH_FAILED',
        message: 'Batch operation failed',
        details: {
          batchIndex: 5,
          failedRecords: ['rec-1', 'rec-2'],
          retryable: true,
        },
      })

      expect(status.error?.details).toEqual({
        batchIndex: 5,
        failedRecords: ['rec-1', 'rec-2'],
        retryable: true,
      })
    })
  })

  // =============================================================================
  // DURATION CALCULATION TESTS
  // =============================================================================

  describe('duration calculation', () => {
    it('calculates duration for completed sync', () => {
      vi.useFakeTimers()
      const start = new Date('2026-01-13T10:00:00Z')
      vi.setSystemTime(start)

      const status = new SyncStatus({
        syncId: 'sync-123',
        planId: 'plan-456',
      })
      status.start()

      // Advance time by 30 seconds
      vi.setSystemTime(new Date('2026-01-13T10:00:30Z'))
      status.complete()

      expect(status.durationMs).toBe(30000)

      vi.useRealTimers()
    })

    it('calculates duration for running sync', () => {
      vi.useFakeTimers()
      const start = new Date('2026-01-13T10:00:00Z')
      vi.setSystemTime(start)

      const status = new SyncStatus({
        syncId: 'sync-123',
        planId: 'plan-456',
      })
      status.start()

      // Advance time by 15 seconds
      vi.setSystemTime(new Date('2026-01-13T10:00:15Z'))

      expect(status.durationMs).toBe(15000)

      vi.useRealTimers()
    })

    it('returns undefined duration for pending sync', () => {
      const status = new SyncStatus({
        syncId: 'sync-123',
        planId: 'plan-456',
      })

      expect(status.durationMs).toBeUndefined()
    })
  })

  // =============================================================================
  // FACTORY FUNCTION TESTS
  // =============================================================================

  describe('createSyncStatus factory', () => {
    it('creates status with provided options', () => {
      const status = createSyncStatus({
        syncId: 'custom-sync-id',
        planId: 'plan-789',
        totalRecords: 500,
      })

      expect(status.syncId).toBe('custom-sync-id')
      expect(status.planId).toBe('plan-789')
      expect(status.progress.totalRecords).toBe(500)
    })

    it('creates status with generated syncId', () => {
      const status = createSyncStatus({
        planId: 'plan-789',
      })

      expect(status.syncId).toBeDefined()
      expect(status.syncId.length).toBeGreaterThan(0)
    })
  })
})
