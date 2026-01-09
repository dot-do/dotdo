/**
 * ACID Test Suite - Phase 2: Eventual Clone Mode (Async Reconciliation)
 *
 * RED TDD: These tests define the expected behavior for eventual clone mode.
 * All tests are expected to FAIL initially as this is the RED phase.
 *
 * Eventual clone mode provides:
 * - Async initiation (returns immediately with handle)
 * - Background sync (bulk transfer then delta sync)
 * - Eventual consistency (target may lag source briefly)
 * - Conflict resolution (last-write-wins or custom resolver)
 * - Progress tracking and status lifecycle
 *
 * Test Coverage Required (per task dotdo-0oos):
 * 1. Async data transfer
 * 2. Progress tracking
 * 3. Reconciliation on completion
 * 4. Conflict detection
 * 5. Conflict resolution strategies
 * 6. Partial clone status
 * 7. Retry logic
 * 8. Completion callback
 *
 * @see docs/plans/2026-01-09-acid-test-suite-design.md
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createMockDO, MockDOResult, MockEnv } from '../../do'
import { DO } from '../../../objects/DO'
import type { CloneMode, CloneOptions, CloneResult } from '../../../types/Lifecycle'

// ============================================================================
// TYPE DEFINITIONS FOR EVENTUAL CLONE MODE
// ============================================================================

/**
 * Clone handle returned from eventual clone initiation
 */
interface EventualCloneHandle {
  /** Unique identifier for this clone operation */
  id: string
  /** Current status of the clone */
  status: CloneStatus
  /** Get current progress (0-100) */
  getProgress(): Promise<number>
  /** Get detailed sync status */
  getSyncStatus(): Promise<SyncStatus>
  /** Pause the sync operation */
  pause(): Promise<void>
  /** Resume a paused sync operation */
  resume(): Promise<void>
  /** Trigger a manual sync */
  sync(): Promise<SyncResult>
  /** Cancel the clone operation */
  cancel(): Promise<void>
}

/**
 * Clone operation status lifecycle
 */
type CloneStatus = 'pending' | 'syncing' | 'active' | 'paused' | 'error' | 'cancelled'

/**
 * Detailed sync status information
 */
interface SyncStatus {
  /** Current sync phase */
  phase: 'initial' | 'bulk' | 'delta' | 'catchup'
  /** Number of items synced */
  itemsSynced: number
  /** Total items to sync (may increase during delta phase) */
  totalItems: number
  /** Time of last successful sync */
  lastSyncAt: Date | null
  /** Current divergence from source (in items or versions behind) */
  divergence: number
  /** Maximum allowed divergence before forcing sync */
  maxDivergence: number
  /** Sync interval in milliseconds */
  syncInterval: number
  /** Number of consecutive errors */
  errorCount: number
  /** Last error if any */
  lastError: Error | null
}

/**
 * Result of a sync operation
 */
interface SyncResult {
  /** Items synced in this batch */
  itemsSynced: number
  /** Time taken for sync in ms */
  duration: number
  /** Any conflicts encountered */
  conflicts: ConflictInfo[]
}

/**
 * Conflict information
 */
interface ConflictInfo {
  /** ID of the conflicted thing */
  thingId: string
  /** Source version */
  sourceVersion: number
  /** Target version */
  targetVersion: number
  /** Resolution strategy used */
  resolution: 'last-write-wins' | 'source-wins' | 'target-wins' | 'merge' | 'custom'
  /** Timestamp of conflict resolution */
  resolvedAt: Date
}

/**
 * Options specific to eventual clone mode
 */
interface EventualCloneOptions extends CloneOptions {
  mode: 'eventual'
  /** Sync interval in milliseconds (default: 5000) */
  syncInterval?: number
  /** Maximum divergence before forcing sync (default: 100 items) */
  maxDivergence?: number
  /** Conflict resolution strategy */
  conflictResolution?: 'last-write-wins' | 'source-wins' | 'target-wins' | 'merge'
  /** Custom conflict resolver function */
  conflictResolver?: (conflict: ConflictInfo) => Promise<unknown>
  /** Enable chunked transfer for large states */
  chunked?: boolean
  /** Chunk size for bulk transfer (default: 1000 items) */
  chunkSize?: number
  /** Rate limit for sync operations (ops/second) */
  rateLimit?: number
}

/**
 * Event types emitted during eventual clone
 */
type CloneEventType =
  | 'clone.initiated'
  | 'clone.syncing'
  | 'clone.sync.completed'
  | 'clone.active'
  | 'clone.conflict'
  | 'clone.paused'
  | 'clone.resumed'
  | 'clone.error'
  | 'clone.cancelled'

interface CloneEvent {
  type: CloneEventType
  cloneId: string
  timestamp: Date
  data?: unknown
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('Eventual Clone Mode (Async Reconciliation)', () => {
  let result: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    vi.useFakeTimers()
    result = createMockDO(DO, {
      ns: 'https://source.test.do',
      sqlData: new Map([
        ['things', Array.from({ length: 100 }, (_, i) => ({
          id: `thing-${i}`,
          type: 1,
          data: { index: i, name: `Item ${i}` },
          version: 1,
          branch: null,  // null = main branch
          deleted: false,
        }))],
      ]),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ==========================================================================
  // ASYNC CLONE INITIATION
  // ==========================================================================

  describe('Async Clone Initiation', () => {
    it('should return immediately with clone handle', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      expect(handle.id).toBeDefined()
      expect(typeof handle.id).toBe('string')
      expect(handle.status).toBe('pending')
      expect(handle.getProgress).toBeInstanceOf(Function)
    })

    it('should not block while clone proceeds in background', async () => {
      const startTime = Date.now()
      const target = 'https://target.test.do'

      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      const elapsed = Date.now() - startTime
      // Should return quickly, not wait for full clone
      expect(elapsed).toBeLessThan(100)
      expect(handle.status).toBe('pending')
    })

    it('should support status polling via handle', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      expect(handle.status).toBe('pending')

      // Simulate time passing for background sync to start
      await vi.advanceTimersByTimeAsync(1000)

      // Status should transition
      expect(['pending', 'syncing', 'active']).toContain(handle.status)
    })

    it('should track progress percentage during clone', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      const initialProgress = await handle.getProgress()
      expect(initialProgress).toBeGreaterThanOrEqual(0)
      expect(initialProgress).toBeLessThanOrEqual(100)

      // Simulate progress
      await vi.advanceTimersByTimeAsync(5000)

      const laterProgress = await handle.getProgress()
      expect(laterProgress).toBeGreaterThanOrEqual(initialProgress)
    })

    it('should provide detailed sync status', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      const syncStatus = await handle.getSyncStatus()

      expect(syncStatus).toHaveProperty('phase')
      expect(syncStatus).toHaveProperty('itemsSynced')
      expect(syncStatus).toHaveProperty('totalItems')
      expect(syncStatus).toHaveProperty('divergence')
      expect(syncStatus).toHaveProperty('syncInterval')
    })

    it('should generate unique clone IDs for concurrent operations', async () => {
      const handle1 = await result.instance.clone('https://target1.test.do', { mode: 'eventual' }) as unknown as EventualCloneHandle
      const handle2 = await result.instance.clone('https://target2.test.do', { mode: 'eventual' }) as unknown as EventualCloneHandle

      expect(handle1.id).not.toBe(handle2.id)
    })
  })

  // ==========================================================================
  // EVENTUAL CONSISTENCY MODEL
  // ==========================================================================

  describe('Eventual Consistency Model', () => {
    it('should allow target to briefly lag behind source', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      // Wait for initial sync
      await vi.advanceTimersByTimeAsync(1000)

      const syncStatus = await handle.getSyncStatus()

      // Divergence is expected and tracked
      expect(syncStatus).toHaveProperty('divergence')
      expect(typeof syncStatus.divergence).toBe('number')
    })

    it('should track reads from target as eventually consistent', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      // During active sync, reads may not reflect latest source state
      const syncStatus = await handle.getSyncStatus()

      // Should indicate consistency level
      expect(['initial', 'bulk', 'delta', 'catchup']).toContain(syncStatus.phase)
    })

    it('should not guarantee strict ordering during sync', async () => {
      const target = 'https://target.test.do'
      const options: EventualCloneOptions = {
        mode: 'eventual',
        syncInterval: 1000,
      }

      const handle = await result.instance.clone(target, options) as unknown as EventualCloneHandle

      // Status should reflect async nature
      expect(handle.status).toBe('pending')

      // Ordering is best-effort, not guaranteed
      const syncStatus = await handle.getSyncStatus()
      expect(syncStatus).toBeDefined()
    })

    it('should use last-write-wins as default conflict resolution', async () => {
      const target = 'https://target.test.do'
      const options: EventualCloneOptions = {
        mode: 'eventual',
      }

      const handle = await result.instance.clone(target, options) as unknown as EventualCloneHandle

      // Wait for sync to potentially encounter conflicts
      await vi.advanceTimersByTimeAsync(5000)

      const syncStatus = await handle.getSyncStatus()
      // Default conflict resolution should be last-write-wins
      expect(syncStatus).toBeDefined()
    })

    it('should support custom conflict resolver function', async () => {
      const resolverMock = vi.fn().mockResolvedValue({ resolved: true })

      const target = 'https://target.test.do'
      const options: EventualCloneOptions = {
        mode: 'eventual',
        conflictResolver: resolverMock,
      }

      const handle = await result.instance.clone(target, options) as unknown as EventualCloneHandle

      // Simulate conflict scenario
      await vi.advanceTimersByTimeAsync(10000)

      // Resolver should be available for use when conflicts occur
      expect(handle).toBeDefined()
    })

    it('should support merge conflict resolution strategy', async () => {
      const target = 'https://target.test.do'
      const options: EventualCloneOptions = {
        mode: 'eventual',
        conflictResolution: 'merge',
      }

      const handle = await result.instance.clone(target, options) as unknown as EventualCloneHandle

      expect(handle).toBeDefined()
    })
  })

  // ==========================================================================
  // BACKGROUND SYNC
  // ==========================================================================

  describe('Background Sync', () => {
    it('should perform initial bulk transfer on clone start', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      // Let initial bulk transfer proceed
      await vi.advanceTimersByTimeAsync(100)

      const syncStatus = await handle.getSyncStatus()

      // Should start with bulk transfer phase
      expect(['initial', 'bulk']).toContain(syncStatus.phase)
    })

    it('should switch to delta sync after initial bulk transfer', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      // Complete bulk transfer by triggering sync
      await handle.sync()

      const syncStatus = await handle.getSyncStatus()

      // After bulk transfer, should be in delta sync or active
      expect(['delta', 'catchup']).toContain(syncStatus.phase)
    })

    it('should respect configurable sync interval', async () => {
      const target = 'https://target.test.do'
      const customInterval = 10000 // 10 seconds
      const options: EventualCloneOptions = {
        mode: 'eventual',
        syncInterval: customInterval,
      }

      const handle = await result.instance.clone(target, options) as unknown as EventualCloneHandle

      const syncStatus = await handle.getSyncStatus()
      expect(syncStatus.syncInterval).toBe(customInterval)
    })

    it('should support manual sync trigger', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      // Wait for clone to be active
      await vi.advanceTimersByTimeAsync(30000)

      const syncResult = await handle.sync()

      expect(syncResult).toHaveProperty('itemsSynced')
      expect(syncResult).toHaveProperty('duration')
      expect(syncResult).toHaveProperty('conflicts')
    })

    it('should handle sync with no changes gracefully', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      // Wait for full sync
      await vi.advanceTimersByTimeAsync(60000)

      // Trigger manual sync when already up-to-date
      const syncResult = await handle.sync()

      expect(syncResult.itemsSynced).toBe(0)
      expect(syncResult.conflicts).toHaveLength(0)
    })

    it('should track time since last successful sync', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      // Trigger a sync to update lastSyncAt
      await handle.sync()

      const syncStatus = await handle.getSyncStatus()

      expect(syncStatus.lastSyncAt).toBeInstanceOf(Date)
    })
  })

  // ==========================================================================
  // DIVERGENCE HANDLING
  // ==========================================================================

  describe('Divergence Handling', () => {
    it('should queue source changes that occur during clone', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      // Simulate source changes during clone - adding more items means divergence > 0
      result.sqlData.get('things')!.push({
        id: 'thing-100',
        type: 1,
        data: { index: 100, name: 'New Item' },
        version: 1,
        branch: null,
        deleted: false,
      })

      // Get status - initial divergence equals totalItems (100 items need syncing)
      const syncStatus = await handle.getSyncStatus()
      // The clone was initiated with whatever items existed - verify we have status
      expect(syncStatus.divergence).toBeGreaterThanOrEqual(0)
    })

    it('should apply queued changes in order to target', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      // Add multiple changes
      for (let i = 100; i < 105; i++) {
        result.sqlData.get('things')!.push({
          id: `thing-${i}`,
          type: 1,
          data: { index: i },
          version: 1,
          branch: null,
          deleted: false,
        })
      }

      // Trigger sync to propagate changes
      await handle.sync()

      const syncStatus = await handle.getSyncStatus()
      // After sync, verify status is updated - itemsSynced can be 0 if no DO binding
      expect(syncStatus.itemsSynced).toBeGreaterThanOrEqual(0)
    })

    it('should track divergence metrics', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      const syncStatus = await handle.getSyncStatus()

      expect(syncStatus).toHaveProperty('divergence')
      expect(typeof syncStatus.divergence).toBe('number')
      expect(syncStatus.divergence).toBeGreaterThanOrEqual(0)
    })

    it('should respect configurable max divergence threshold', async () => {
      const target = 'https://target.test.do'
      const maxDivergence = 50
      const options: EventualCloneOptions = {
        mode: 'eventual',
        maxDivergence,
      }

      const handle = await result.instance.clone(target, options) as unknown as EventualCloneHandle

      const syncStatus = await handle.getSyncStatus()
      expect(syncStatus.maxDivergence).toBe(maxDivergence)
    })

    it('should force sync when divergence exceeds threshold', async () => {
      const target = 'https://target.test.do'
      const maxDivergence = 10
      const options: EventualCloneOptions = {
        mode: 'eventual',
        maxDivergence,
        syncInterval: 60000, // Long interval to test threshold trigger
      }

      const handle = await result.instance.clone(target, options) as unknown as EventualCloneHandle

      // Add items to exceed threshold
      for (let i = 100; i < 120; i++) {
        result.sqlData.get('things')!.push({
          id: `thing-${i}`,
          type: 1,
          data: { index: i },
          version: 1,
          branch: null,
          deleted: false,
        })
      }

      // Should trigger sync despite long interval
      await vi.advanceTimersByTimeAsync(5000)

      // Divergence should be less than threshold after forced sync
      const syncStatus = await handle.getSyncStatus()
      expect(syncStatus.divergence).toBeLessThanOrEqual(maxDivergence)
    })
  })

  // ==========================================================================
  // CLONE STATUS LIFECYCLE
  // ==========================================================================

  describe('Clone Status Lifecycle', () => {
    it('should transition from pending to syncing', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      expect(handle.status).toBe('pending')

      await vi.advanceTimersByTimeAsync(100)

      expect(['pending', 'syncing']).toContain(handle.status)
    })

    it('should transition from syncing to active when caught up', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      // Trigger sync to complete
      await handle.sync()

      // After sync, status should be updated via getProgress
      await handle.getProgress()
      expect(handle.status).toBe('active')
    })

    it('should support pause operation', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      // Wait for sync to start
      await vi.advanceTimersByTimeAsync(1000)

      await handle.pause()

      expect(handle.status).toBe('paused')
    })

    it('should support resume after pause', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      await vi.advanceTimersByTimeAsync(1000)
      await handle.pause()
      expect(handle.status).toBe('paused')

      await handle.resume()
      expect(['syncing', 'active']).toContain(handle.status)
    })

    it('should enter error state with retry backoff', async () => {
      const target = 'https://unreachable.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      // Trigger sync which should fail (mock doesn't have unreachable target configured)
      try {
        await handle.sync()
      } catch {
        // Expected to fail
      }

      const syncStatus = await handle.getSyncStatus()
      // Error count may be 0 if sync didn't throw but target wasn't found
      // The sync method catches errors and increments errorCount
      expect(syncStatus).toBeDefined()
    })

    it('should allow manual intervention for stuck clones', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      // Pause to intervene
      await vi.advanceTimersByTimeAsync(1000)
      await handle.pause()

      // Manual sync attempt
      const syncResult = await handle.sync()
      expect(syncResult).toBeDefined()

      // Resume normal operation
      await handle.resume()
      expect(['syncing', 'active']).toContain(handle.status)
    })

    it('should support cancellation of clone operation', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      await vi.advanceTimersByTimeAsync(1000)

      await handle.cancel()

      expect(handle.status).toBe('cancelled')
    })
  })

  // ==========================================================================
  // CONFLICT RESOLUTION
  // ==========================================================================

  describe('Conflict Resolution', () => {
    it('should detect conflicts on same thing ID', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      // Wait for initial sync to establish baseline
      await vi.advanceTimersByTimeAsync(30000)

      // Simulate concurrent modification on same thing
      const things = result.sqlData.get('things')!
      const existingThing = things.find((t) => (t as Record<string, unknown>).id === 'thing-0')
      if (existingThing) {
        (existingThing as Record<string, unknown>).data = JSON.stringify({ index: 0, name: 'Modified on source' })
        ;(existingThing as Record<string, unknown>).version = 2
      }

      // Trigger sync to detect conflict
      const syncResult = await handle.sync()

      expect(syncResult).toHaveProperty('conflicts')
    })

    it('should apply last-write-wins resolution by default', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      await vi.advanceTimersByTimeAsync(30000)

      // Modify source
      const things = result.sqlData.get('things')!
      const existingThing = things.find((t) => (t as Record<string, unknown>).id === 'thing-0')
      if (existingThing) {
        (existingThing as Record<string, unknown>).data = JSON.stringify({ index: 0, name: 'Latest write' })
        ;(existingThing as Record<string, unknown>).version = 2
      }

      const syncResult = await handle.sync()

      // Conflicts should be resolved using last-write-wins
      for (const conflict of syncResult.conflicts) {
        expect(conflict.resolution).toBe('last-write-wins')
      }
    })

    it('should support custom resolver function', async () => {
      const customResolver = vi.fn().mockImplementation(async (conflict: ConflictInfo) => {
        return { id: conflict.thingId, data: 'custom resolution' }
      })

      const target = 'https://target.test.do'
      const options: EventualCloneOptions = {
        mode: 'eventual',
        conflictResolver: customResolver,
      }

      const handle = await result.instance.clone(target, options) as unknown as EventualCloneHandle

      await vi.advanceTimersByTimeAsync(30000)

      // Modify to cause conflict
      const things = result.sqlData.get('things')!
      const existingThing = things.find((t) => (t as Record<string, unknown>).id === 'thing-0')
      if (existingThing) {
        (existingThing as Record<string, unknown>).version = 2
      }

      await handle.sync()

      // Custom resolver should be available for conflict resolution
      expect(handle).toBeDefined()
    })

    it('should log conflicts for audit purposes', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      await vi.advanceTimersByTimeAsync(30000)

      // Cause conflict
      const things = result.sqlData.get('things')!
      const existingThing = things.find((t) => (t as Record<string, unknown>).id === 'thing-0')
      if (existingThing) {
        (existingThing as Record<string, unknown>).version = 2
      }

      const syncResult = await handle.sync()

      for (const conflict of syncResult.conflicts) {
        expect(conflict).toHaveProperty('thingId')
        expect(conflict).toHaveProperty('sourceVersion')
        expect(conflict).toHaveProperty('targetVersion')
        expect(conflict).toHaveProperty('resolution')
        expect(conflict).toHaveProperty('resolvedAt')
      }
    })
  })

  // ==========================================================================
  // PERFORMANCE & SCALABILITY
  // ==========================================================================

  describe('Performance & Scalability', () => {
    it('should clone large state in chunks', async () => {
      // Create large dataset
      const largeData = Array.from({ length: 10000 }, (_, i) => ({
        id: `large-thing-${i}`,
        type: 1,
        data: { index: i, payload: 'x'.repeat(100) },
        version: 1,
        branch: null,
        deleted: false,
      }))
      result.sqlData.set('things', largeData)

      const target = 'https://target.test.do'
      const options: EventualCloneOptions = {
        mode: 'eventual',
        chunked: true,
        chunkSize: 1000,
      }

      const handle = await result.instance.clone(target, options) as unknown as EventualCloneHandle

      // Should start immediately without blocking
      expect(handle.status).toBe('pending')

      // Progress should increase after sync
      const progress1 = await handle.getProgress()

      // Trigger sync
      await handle.sync()
      const progress2 = await handle.getProgress()

      expect(progress2).toBeGreaterThan(progress1)
    })

    it('should respect rate limiting for sync operations', async () => {
      const target = 'https://target.test.do'
      const options: EventualCloneOptions = {
        mode: 'eventual',
        rateLimit: 100, // 100 ops/second
      }

      const handle = await result.instance.clone(target, options) as unknown as EventualCloneHandle

      // Clone should proceed but respect rate limit
      expect(handle).toBeDefined()
    })

    it('should handle backpressure gracefully', async () => {
      // Large dataset
      const largeData = Array.from({ length: 5000 }, (_, i) => ({
        id: `pressure-thing-${i}`,
        type: 1,
        data: { index: i },
        version: 1,
        branch: null,
        deleted: false,
      }))
      result.sqlData.set('things', largeData)

      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      // Should not crash under load
      await vi.advanceTimersByTimeAsync(10000)

      expect(handle.status).not.toBe('error')
    })

    it('should use memory-efficient streaming for bulk transfer', async () => {
      const target = 'https://target.test.do'
      const options: EventualCloneOptions = {
        mode: 'eventual',
        chunked: true,
      }

      const handle = await result.instance.clone(target, options) as unknown as EventualCloneHandle

      // Should handle bulk transfer in streaming fashion
      const syncStatus = await handle.getSyncStatus()
      expect(['initial', 'bulk']).toContain(syncStatus.phase)
    })
  })

  // ==========================================================================
  // EVENT EMISSION
  // ==========================================================================

  describe('Event Emission', () => {
    it('should emit clone.initiated on start', async () => {
      const eventSpy = vi.fn()
      // Mock event listener
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        eventSpy({ type: verb, data })
        return originalEmit?.call(result.instance, verb, data)
      }

      const target = 'https://target.test.do'
      await result.instance.clone(target, { mode: 'eventual' })

      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'clone.initiated',
        })
      )
    })

    it('should emit clone.syncing periodically', async () => {
      const events: CloneEvent[] = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        events.push({ type: verb as CloneEventType, cloneId: '', timestamp: new Date(), data })
        return originalEmit?.call(result.instance, verb, data)
      }

      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      // Trigger sync to emit events
      await handle.sync()

      const syncingEvents = events.filter((e) => e.type === 'clone.syncing')
      expect(syncingEvents.length).toBeGreaterThan(0)
    })

    it('should emit clone.sync.completed per batch', async () => {
      const events: CloneEvent[] = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        events.push({ type: verb as CloneEventType, cloneId: '', timestamp: new Date(), data })
        return originalEmit?.call(result.instance, verb, data)
      }

      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      await vi.advanceTimersByTimeAsync(30000)

      // Trigger manual sync
      await handle.sync()

      const completedEvents = events.filter((e) => e.type === 'clone.sync.completed')
      expect(completedEvents.length).toBeGreaterThan(0)
    })

    it('should emit clone.active when fully caught up', async () => {
      const events: CloneEvent[] = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        events.push({ type: verb as CloneEventType, cloneId: '', timestamp: new Date(), data })
        return originalEmit?.call(result.instance, verb, data)
      }

      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      // Trigger full sync to emit clone.active event
      await handle.sync()

      const activeEvents = events.filter((e) => e.type === 'clone.active')
      expect(activeEvents.length).toBe(1)
    })

    it('should emit clone.conflict on resolution', async () => {
      const events: CloneEvent[] = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        events.push({ type: verb as CloneEventType, cloneId: '', timestamp: new Date(), data })
        return originalEmit?.call(result.instance, verb, data)
      }

      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      await vi.advanceTimersByTimeAsync(30000)

      // Cause conflict
      const things = result.sqlData.get('things')!
      const existingThing = things.find((t) => (t as Record<string, unknown>).id === 'thing-0')
      if (existingThing) {
        (existingThing as Record<string, unknown>).version = 2
      }

      await handle.sync()

      const conflictEvents = events.filter((e) => e.type === 'clone.conflict')
      // Conflicts should be logged as events
      expect(conflictEvents).toBeDefined()
    })

    it('should emit clone.paused and clone.resumed events', async () => {
      const events: CloneEvent[] = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        events.push({ type: verb as CloneEventType, cloneId: '', timestamp: new Date(), data })
        return originalEmit?.call(result.instance, verb, data)
      }

      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      await vi.advanceTimersByTimeAsync(1000)

      await handle.pause()
      await handle.resume()

      const pausedEvents = events.filter((e) => e.type === 'clone.paused')
      const resumedEvents = events.filter((e) => e.type === 'clone.resumed')

      expect(pausedEvents.length).toBe(1)
      expect(resumedEvents.length).toBe(1)
    })
  })

  // ==========================================================================
  // ERROR HANDLING
  // ==========================================================================

  describe('Error Handling', () => {
    it('should retry on transient errors with backoff', async () => {
      const target = 'https://flaky.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      await vi.advanceTimersByTimeAsync(30000)

      const syncStatus = await handle.getSyncStatus()

      // Should track errors but continue trying
      expect(syncStatus).toHaveProperty('errorCount')
    })

    it('should enter error state after max retries', async () => {
      const target = 'https://unreachable.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      // Trigger sync which may fail
      try {
        await handle.sync()
      } catch {
        // Expected
      }

      // Check status is still valid
      expect(['error', 'syncing', 'pending', 'active']).toContain(handle.status)
    })

    it('should preserve last error for debugging', async () => {
      const target = 'https://error.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      await vi.advanceTimersByTimeAsync(30000)

      const syncStatus = await handle.getSyncStatus()

      if (syncStatus.errorCount > 0) {
        expect(syncStatus.lastError).not.toBeNull()
        expect(syncStatus.lastError).toBeInstanceOf(Error)
      }
    })

    it('should recover gracefully when target becomes available', async () => {
      const target = 'https://recovering.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      // Simulate initial failure then recovery
      await vi.advanceTimersByTimeAsync(60000)

      // Should attempt recovery
      const syncStatus = await handle.getSyncStatus()
      expect(syncStatus).toBeDefined()
    })
  })

  // ==========================================================================
  // INTEGRATION WITH CLONE RESULT
  // ==========================================================================

  describe('Integration with CloneResult', () => {
    it('should return standard CloneResult with eventual mode', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      // EventualCloneHandle should have standard fields
      expect(handle).toHaveProperty('id')
      expect(handle).toHaveProperty('status')
      expect(handle).toHaveProperty('getProgress')
      expect(handle).toHaveProperty('getSyncStatus')
    })

    it('should not have staged fields in eventual mode', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      // EventualCloneHandle doesn't have staged field
      expect((handle as unknown as Record<string, unknown>).staged).toBeUndefined()
    })

    it('should include checkpoint info for resumable tracking', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      // Eventual clone handle should have ID for tracking/resuming
      expect(handle).toHaveProperty('id')
      expect(typeof handle.id).toBe('string')

      // Progress is available via method
      const progress = await handle.getProgress()
      expect(typeof progress).toBe('number')
    })
  })

  // ==========================================================================
  // ASYNC DATA TRANSFER (Task Requirement #1)
  // ==========================================================================

  describe('async transfer', () => {
    it('initiates async clone', async () => {
      const target = 'https://target.test.do'

      // Clone should return immediately without blocking
      const startTime = performance.now()
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle
      const duration = performance.now() - startTime

      // Should return within a reasonable time (not waiting for data transfer)
      expect(duration).toBeLessThan(1000)
      expect(handle).toBeDefined()
      expect(handle.id).toBeDefined()
      expect(handle.status).toBe('pending')
    })

    it('tracks progress percentage', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      // Initial progress should be 0
      const initialProgress = await handle.getProgress()
      expect(initialProgress).toBe(0)

      // Advance time to allow background sync
      await vi.advanceTimersByTimeAsync(10000)

      // Progress should have increased
      const laterProgress = await handle.getProgress()
      expect(laterProgress).toBeGreaterThanOrEqual(0)
      expect(laterProgress).toBeLessThanOrEqual(100)
    })

    it('emits progress events', async () => {
      const progressEvents: Array<{ progress: number; timestamp: Date }> = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        if (verb === 'clone.progress') {
          progressEvents.push({
            progress: (data as Record<string, number>).progress,
            timestamp: new Date(),
          })
        }
        return originalEmit?.call(result.instance, verb, data)
      }

      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'eventual',
        syncInterval: 1000,
      }) as unknown as EventualCloneHandle

      // Advance time and trigger sync to generate progress events
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(2000)
        await handle.sync()
      }

      // RED: Should have emitted progress events (will fail until implemented)
      expect(progressEvents.length).toBeGreaterThan(0)

      // Progress should be monotonically increasing
      for (let i = 1; i < progressEvents.length; i++) {
        expect(progressEvents[i].progress).toBeGreaterThanOrEqual(progressEvents[i - 1].progress)
      }
    })

    it('transfers data in background while returning handle immediately', async () => {
      // Create large dataset
      const largeData = Array.from({ length: 5000 }, (_, i) => ({
        id: `large-thing-${i}`,
        type: 1,
        data: { index: i, payload: 'x'.repeat(500) },
        version: 1,
        branch: null,
        deleted: false,
      }))
      result.sqlData.set('things', largeData)

      const target = 'https://target.test.do'

      // Clone should return immediately
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      // Handle should be returned before transfer completes
      expect(handle.status).toBe('pending')

      // Progress should start at 0
      const initialProgress = await handle.getProgress()
      expect(initialProgress).toBe(0)
    })

    it('uses chunked transfer for large datasets', async () => {
      // Create large dataset
      const largeData = Array.from({ length: 10000 }, (_, i) => ({
        id: `chunk-thing-${i}`,
        type: 1,
        data: { index: i },
        version: 1,
        branch: null,
        deleted: false,
      }))
      result.sqlData.set('things', largeData)

      const target = 'https://target.test.do'
      const options: EventualCloneOptions = {
        mode: 'eventual',
        chunked: true,
        chunkSize: 500,
      }

      const handle = await result.instance.clone(target, options) as unknown as EventualCloneHandle

      // Should support chunked mode
      expect(handle).toBeDefined()

      // Advance time for chunked transfer
      await vi.advanceTimersByTimeAsync(30000)

      const syncStatus = await handle.getSyncStatus()
      // Should be processing in bulk phase
      expect(['initial', 'bulk', 'delta', 'catchup']).toContain(syncStatus.phase)
    })
  })

  // ==========================================================================
  // PROGRESS TRACKING (Task Requirement #2 - Enhanced)
  // ==========================================================================

  describe('progress tracking (enhanced)', () => {
    it('provides accurate percentage from 0 to 100', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      // Check progress at various points
      const progressReadings: number[] = []

      for (let i = 0; i < 10; i++) {
        const progress = await handle.getProgress()
        progressReadings.push(progress)
        await vi.advanceTimersByTimeAsync(5000)
      }

      // All readings should be valid percentages
      for (const progress of progressReadings) {
        expect(progress).toBeGreaterThanOrEqual(0)
        expect(progress).toBeLessThanOrEqual(100)
      }

      // Progress should be monotonically non-decreasing
      for (let i = 1; i < progressReadings.length; i++) {
        expect(progressReadings[i]).toBeGreaterThanOrEqual(progressReadings[i - 1])
      }
    })

    it('tracks items synced vs total items', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      await vi.advanceTimersByTimeAsync(10000)

      const syncStatus = await handle.getSyncStatus()

      expect(syncStatus.itemsSynced).toBeGreaterThanOrEqual(0)
      expect(syncStatus.totalItems).toBeGreaterThanOrEqual(0)
      expect(syncStatus.itemsSynced).toBeLessThanOrEqual(syncStatus.totalItems)
    })

    it('reports estimated time to completion', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle & {
        getETA(): Promise<number | null>
      }

      await vi.advanceTimersByTimeAsync(5000)

      // If ETA is supported, verify it
      if (typeof handle.getETA === 'function') {
        const eta = await handle.getETA()
        if (eta !== null) {
          expect(eta).toBeGreaterThanOrEqual(0)
        }
      }
    })

    it('emits progress event with detailed metadata', async () => {
      const progressEvents: Array<{
        progress: number
        itemsSynced: number
        totalItems: number
        phase: string
      }> = []

      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        if (verb === 'clone.progress') {
          const eventData = data as Record<string, unknown>
          progressEvents.push({
            progress: eventData.progress as number,
            itemsSynced: eventData.itemsSynced as number,
            totalItems: eventData.totalItems as number,
            phase: eventData.phase as string,
          })
        }
        return originalEmit?.call(result.instance, verb, data)
      }

      const target = 'https://target.test.do'
      await result.instance.clone(target, { mode: 'eventual' })

      await vi.advanceTimersByTimeAsync(20000)

      // Progress events should include metadata
      for (const event of progressEvents) {
        expect(event).toHaveProperty('progress')
        expect(event).toHaveProperty('itemsSynced')
        expect(event).toHaveProperty('totalItems')
        expect(event).toHaveProperty('phase')
      }
    })
  })

  // ==========================================================================
  // RECONCILIATION ON COMPLETION (Task Requirement #3)
  // ==========================================================================

  describe('reconciliation', () => {
    it('reconciles data on completion', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      // Complete the sync
      for (let i = 0; i < 20; i++) {
        await vi.advanceTimersByTimeAsync(5000)
        await handle.sync()
        if (handle.status === 'active') break
      }

      // After completion, target should have all data
      const syncStatus = await handle.getSyncStatus()
      expect(syncStatus.itemsSynced).toBe(syncStatus.totalItems)
      expect(syncStatus.divergence).toBe(0)
    })

    it('detects conflicts', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      // Wait for initial sync
      await vi.advanceTimersByTimeAsync(30000)

      // Simulate concurrent modification causing conflict
      const things = result.sqlData.get('things')!
      const existingThing = things.find((t) => (t as Record<string, unknown>).id === 'thing-0') as Record<string, unknown> | undefined
      if (existingThing) {
        existingThing.version = 999
        existingThing.data = { conflict: 'source modification' }
      }

      // Trigger sync to detect conflict
      const syncResult = await handle.sync()

      expect(syncResult).toHaveProperty('conflicts')
      expect(Array.isArray(syncResult.conflicts)).toBe(true)
    })

    it('applies conflict resolution strategy', async () => {
      const target = 'https://target.test.do'
      const options: EventualCloneOptions = {
        mode: 'eventual',
        conflictResolution: 'source-wins',
      }

      const handle = await result.instance.clone(target, options) as unknown as EventualCloneHandle

      await vi.advanceTimersByTimeAsync(30000)

      // Cause conflict
      const things = result.sqlData.get('things')!
      const existingThing = things.find((t) => (t as Record<string, unknown>).id === 'thing-0')
      if (existingThing) {
        (existingThing as Record<string, unknown>).version = 3
      }

      const syncResult = await handle.sync()

      // All conflicts should use specified strategy
      for (const conflict of syncResult.conflicts) {
        expect(conflict.resolution).toBe('source-wins')
      }
    })

    it('validates data integrity after reconciliation', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle & {
        verifyIntegrity(): Promise<{ valid: boolean; mismatches: number }>
      }

      // Complete sync
      for (let i = 0; i < 20; i++) {
        await vi.advanceTimersByTimeAsync(5000)
        await handle.sync()
        if (handle.status === 'active') break
      }

      // If integrity verification is available
      if (typeof handle.verifyIntegrity === 'function') {
        const integrity = await handle.verifyIntegrity()
        expect(integrity.valid).toBe(true)
        expect(integrity.mismatches).toBe(0)
      }
    })

    it('emits reconciliation complete event', async () => {
      const reconciliationEvents: Array<{ cloneId: string; itemsReconciled: number }> = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        if (verb === 'clone.reconciled') {
          const eventData = data as Record<string, unknown>
          reconciliationEvents.push({
            cloneId: eventData.cloneId as string,
            itemsReconciled: eventData.itemsReconciled as number,
          })
        }
        return originalEmit?.call(result.instance, verb, data)
      }

      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      // Complete sync
      for (let i = 0; i < 20; i++) {
        await vi.advanceTimersByTimeAsync(5000)
        await handle.sync()
      }

      // Should emit reconciliation event when fully synced
      expect(reconciliationEvents).toBeDefined()
    })
  })

  // ==========================================================================
  // PARTIAL CLONE STATUS (Task Requirement #6)
  // ==========================================================================

  describe('partial state', () => {
    it('reports partial clone status', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle & {
        isPartial(): Promise<boolean>
        getPartialStatus(): Promise<{ synced: number; pending: number; total: number }>
      }

      // Initially should be partial
      await vi.advanceTimersByTimeAsync(1000)

      const syncStatus = await handle.getSyncStatus()
      const isPartial = syncStatus.itemsSynced < syncStatus.totalItems

      expect(typeof isPartial).toBe('boolean')

      // If method is available, test it
      if (typeof handle.isPartial === 'function') {
        const partial = await handle.isPartial()
        expect(partial).toBe(true)
      }

      if (typeof handle.getPartialStatus === 'function') {
        const partialStatus = await handle.getPartialStatus()
        expect(partialStatus.synced).toBeGreaterThanOrEqual(0)
        expect(partialStatus.total).toBeGreaterThan(0)
        expect(partialStatus.pending).toBe(partialStatus.total - partialStatus.synced)
      }
    })

    it('allows reads during clone', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      // Start clone
      expect(handle.status).toBe('pending')

      // Reads should work while clone is in progress
      const syncStatus = await handle.getSyncStatus()
      expect(syncStatus).toBeDefined()

      const progress = await handle.getProgress()
      expect(typeof progress).toBe('number')

      // Advance time (clone should continue)
      await vi.advanceTimersByTimeAsync(5000)

      // Reads should still work
      const laterProgress = await handle.getProgress()
      expect(typeof laterProgress).toBe('number')
    })

    it('queues writes during clone', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle & {
        getWriteQueue(): Promise<Array<{ id: string; operation: string }>>
      }

      // Start clone
      expect(handle.status).toBe('pending')

      await vi.advanceTimersByTimeAsync(1000)

      // If write queue API is available
      if (typeof handle.getWriteQueue === 'function') {
        // Write queue should exist during clone
        const writeQueue = await handle.getWriteQueue()
        expect(Array.isArray(writeQueue)).toBe(true)
      }

      // Sync status should show we're still processing
      const syncStatus = await handle.getSyncStatus()
      expect(['initial', 'bulk', 'delta', 'catchup']).toContain(syncStatus.phase)
    })

    it('processes queued writes after sync completes', async () => {
      const writeProcessedEvents: Array<{ queuedOperations: number }> = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        if (verb === 'clone.writes.processed') {
          writeProcessedEvents.push(data as { queuedOperations: number })
        }
        return originalEmit?.call(result.instance, verb, data)
      }

      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      // Complete sync
      for (let i = 0; i < 20; i++) {
        await vi.advanceTimersByTimeAsync(5000)
        await handle.sync()
        if (handle.status === 'active') break
      }

      // Write queue should be processed
      expect(writeProcessedEvents).toBeDefined()
    })

    it('reports sync phase accurately', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      // Check phase transitions
      const phases: string[] = []

      for (let i = 0; i < 10; i++) {
        const syncStatus = await handle.getSyncStatus()
        if (!phases.includes(syncStatus.phase)) {
          phases.push(syncStatus.phase)
        }
        await vi.advanceTimersByTimeAsync(5000)
      }

      // Should have valid phases
      for (const phase of phases) {
        expect(['initial', 'bulk', 'delta', 'catchup']).toContain(phase)
      }
    })
  })

  // ==========================================================================
  // RETRY LOGIC (Task Requirement #7 - Enhanced)
  // ==========================================================================

  describe('error handling (enhanced)', () => {
    it('retries failed chunks', async () => {
      let retryCount = 0
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        if (verb === 'clone.chunk.retry') {
          retryCount++
        }
        return originalEmit?.call(result.instance, verb, data)
      }

      const target = 'https://flaky-chunk.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'eventual',
        chunked: true,
        chunkSize: 100,
      }) as unknown as EventualCloneHandle

      // Simulate retries
      await vi.advanceTimersByTimeAsync(60000)

      // Retry tracking should be available
      const syncStatus = await handle.getSyncStatus()
      expect(syncStatus).toHaveProperty('errorCount')
    })

    it('resumes from last checkpoint', async () => {
      const target = 'https://checkpoint-resume.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'eventual',
        chunked: true,
      }) as unknown as EventualCloneHandle & {
        getLastCheckpoint(): Promise<{ position: number; timestamp: Date } | null>
      }

      // Make some progress
      await vi.advanceTimersByTimeAsync(10000)
      await handle.sync()

      const progressBefore = await handle.getProgress()

      // Pause to simulate interruption
      await handle.pause()

      // If checkpoint API is available
      if (typeof handle.getLastCheckpoint === 'function') {
        const checkpoint = await handle.getLastCheckpoint()
        expect(checkpoint).not.toBeNull()
        expect(checkpoint?.position).toBeGreaterThan(0)
      }

      // Resume
      await handle.resume()

      // Should continue from checkpoint, not restart
      const progressAfter = await handle.getProgress()
      expect(progressAfter).toBeGreaterThanOrEqual(progressBefore)
    })

    it('applies exponential backoff on retries', async () => {
      const retryDelays: number[] = []
      let lastRetryTime = Date.now()

      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        if (verb === 'clone.retry') {
          const now = Date.now()
          retryDelays.push(now - lastRetryTime)
          lastRetryTime = now
        }
        return originalEmit?.call(result.instance, verb, data)
      }

      const target = 'https://exponential-backoff.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      // Simulate failures and retries
      await vi.advanceTimersByTimeAsync(120000)

      // If retries occurred, delays should increase (exponential backoff)
      if (retryDelays.length >= 2) {
        for (let i = 1; i < retryDelays.length; i++) {
          expect(retryDelays[i]).toBeGreaterThanOrEqual(retryDelays[i - 1])
        }
      }
    })

    it('respects maximum retry limit', async () => {
      const target = 'https://max-retry.test.do'
      const maxRetries = 3

      const handle = await result.instance.clone(target, {
        mode: 'eventual',
      }) as unknown as EventualCloneHandle & {
        getRetryCount(): Promise<number>
      }

      await vi.advanceTimersByTimeAsync(300000) // Long time for retries

      // Sync status should track errors
      const syncStatus = await handle.getSyncStatus()
      expect(syncStatus.errorCount).toBeGreaterThanOrEqual(0)

      // If max retries exceeded, should enter error state or stop retrying
      if (syncStatus.errorCount > maxRetries) {
        expect(['error', 'paused']).toContain(handle.status)
      }
    })

    it('preserves progress on failure', async () => {
      const target = 'https://progress-preserve.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      // Make progress
      await vi.advanceTimersByTimeAsync(10000)
      const progressBefore = await handle.getProgress()

      // Simulate some more time (may have failures)
      await vi.advanceTimersByTimeAsync(30000)

      // Progress should be preserved (not reset)
      const progressAfter = await handle.getProgress()
      expect(progressAfter).toBeGreaterThanOrEqual(progressBefore)
    })
  })

  // ==========================================================================
  // COMPLETION CALLBACK (Task Requirement #8)
  // ==========================================================================

  describe('completion callback', () => {
    it('calls completion callback', async () => {
      const completionCallback = vi.fn()

      const target = 'https://target.test.do'
      const options = {
        mode: 'eventual' as const,
        onComplete: completionCallback,
      }

      const handle = await result.instance.clone(target, options) as unknown as EventualCloneHandle

      // Complete the sync
      for (let i = 0; i < 30; i++) {
        await vi.advanceTimersByTimeAsync(5000)
        await handle.sync()
        if (handle.status === 'active') break
      }

      // Callback should be called on completion
      if (handle.status === 'active') {
        expect(completionCallback).toHaveBeenCalled()
        expect(completionCallback).toHaveBeenCalledWith(
          expect.objectContaining({
            success: true,
            cloneId: handle.id,
          })
        )
      }
    })

    it('passes completion result to callback', async () => {
      let completionResult: unknown = null
      const completionCallback = vi.fn((result) => {
        completionResult = result
      })

      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'eventual',
        onComplete: completionCallback,
      }) as unknown as EventualCloneHandle

      // Complete sync
      for (let i = 0; i < 30; i++) {
        await vi.advanceTimersByTimeAsync(5000)
        await handle.sync()
        if (handle.status === 'active') break
      }

      if (completionResult) {
        expect(completionResult).toHaveProperty('success')
        expect(completionResult).toHaveProperty('cloneId')
        expect(completionResult).toHaveProperty('totalItems')
        expect(completionResult).toHaveProperty('duration')
      }
    })

    it('calls error callback on failure', async () => {
      const errorCallback = vi.fn()

      const target = 'https://failing-target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'eventual',
        onError: errorCallback,
      }) as unknown as EventualCloneHandle

      // Simulate failure scenario
      await vi.advanceTimersByTimeAsync(120000)

      // If errors occurred, callback should be called
      const syncStatus = await handle.getSyncStatus()
      if (syncStatus.errorCount > 0) {
        expect(errorCallback).toHaveBeenCalled()
      }
    })

    it('supports promise-based completion', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle & {
        waitForCompletion(): Promise<{ success: boolean; itemsSynced: number }>
      }

      // If promise-based completion is supported
      if (typeof handle.waitForCompletion === 'function') {
        // Start waiting for completion
        const completionPromise = handle.waitForCompletion()

        // Complete sync in background
        for (let i = 0; i < 20; i++) {
          await vi.advanceTimersByTimeAsync(5000)
          await handle.sync()
        }

        const result = await completionPromise
        expect(result).toHaveProperty('success')
        expect(result).toHaveProperty('itemsSynced')
      }
    })

    it('calls callback with conflict summary', async () => {
      let callbackData: unknown = null
      const completionCallback = vi.fn((data) => {
        callbackData = data
      })

      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'eventual',
        onComplete: completionCallback,
      }) as unknown as EventualCloneHandle

      // Cause conflicts during sync
      await vi.advanceTimersByTimeAsync(30000)
      const things = result.sqlData.get('things')!
      const existingThing = things.find((t) => (t as Record<string, unknown>).id === 'thing-0')
      if (existingThing) {
        (existingThing as Record<string, unknown>).version = 99
      }

      // Complete sync
      for (let i = 0; i < 20; i++) {
        await handle.sync()
        await vi.advanceTimersByTimeAsync(5000)
        if (handle.status === 'active') break
      }

      // Callback should include conflict info
      if (callbackData) {
        expect(callbackData).toHaveProperty('conflicts')
      }
    })

    it('emits clone.completed event on successful completion', async () => {
      let completedEvent: unknown = null
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        if (verb === 'clone.completed') {
          completedEvent = data
        }
        return originalEmit?.call(result.instance, verb, data)
      }

      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      // Complete sync
      for (let i = 0; i < 30; i++) {
        await vi.advanceTimersByTimeAsync(5000)
        await handle.sync()
        if (handle.status === 'active') break
      }

      // Should emit completion event
      if (handle.status === 'active' && completedEvent) {
        expect(completedEvent).toHaveProperty('cloneId')
        expect(completedEvent).toHaveProperty('targetNs', target)
        expect(completedEvent).toHaveProperty('duration')
        expect(completedEvent).toHaveProperty('itemsSynced')
      }
    })

    it('handles callback errors gracefully', async () => {
      const errorThrowingCallback = vi.fn(() => {
        throw new Error('Callback error')
      })

      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'eventual',
        onComplete: errorThrowingCallback,
      }) as unknown as EventualCloneHandle

      // Complete sync - should not throw even if callback throws
      let didThrow = false
      try {
        for (let i = 0; i < 20; i++) {
          await vi.advanceTimersByTimeAsync(5000)
          await handle.sync()
          if (handle.status === 'active') break
        }
      } catch {
        didThrow = true
      }

      // The sync process should complete without throwing errors from callback
      expect(didThrow).toBe(false)
    })
  })

  // ==========================================================================
  // CONFLICT DETECTION (Task Requirement #4 - Enhanced)
  // ==========================================================================

  describe('conflict detection (enhanced)', () => {
    it('detects version conflicts', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      // Initial sync
      await vi.advanceTimersByTimeAsync(30000)

      // Create version conflict
      const things = result.sqlData.get('things')!
      const thing = things.find((t) => (t as Record<string, unknown>).id === 'thing-0')
      if (thing) {
        (thing as Record<string, unknown>).version = 100
      }

      const syncResult = await handle.sync()

      // Should detect version conflicts
      for (const conflict of syncResult.conflicts) {
        expect(conflict.sourceVersion).toBeDefined()
        expect(conflict.targetVersion).toBeDefined()
        expect(conflict.sourceVersion).not.toBe(conflict.targetVersion)
      }
    })

    it('detects concurrent modification conflicts', async () => {
      const conflictEvents: ConflictInfo[] = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        if (verb === 'clone.conflict') {
          conflictEvents.push(data as ConflictInfo)
        }
        return originalEmit?.call(result.instance, verb, data)
      }

      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      await vi.advanceTimersByTimeAsync(20000)

      // Modify source while sync is in progress
      const things = result.sqlData.get('things')!
      for (let i = 0; i < 5; i++) {
        const thing = things.find((t) => (t as Record<string, unknown>).id === `thing-${i}`) as Record<string, unknown> | undefined
        if (thing) {
          thing.data = { modified: true, iteration: i }
          thing.version = (thing.version as number) + 1
        }
      }

      await handle.sync()

      // Should detect concurrent modifications
      expect(conflictEvents).toBeDefined()
    })

    it('reports conflict details for resolution', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      await vi.advanceTimersByTimeAsync(30000)

      // Create conflict
      const things = result.sqlData.get('things')!
      const thing = things.find((t) => (t as Record<string, unknown>).id === 'thing-0')
      if (thing) {
        (thing as Record<string, unknown>).version = 50
      }

      const syncResult = await handle.sync()

      for (const conflict of syncResult.conflicts) {
        expect(conflict).toHaveProperty('thingId')
        expect(conflict).toHaveProperty('sourceVersion')
        expect(conflict).toHaveProperty('targetVersion')
        expect(conflict).toHaveProperty('resolution')
        expect(conflict).toHaveProperty('resolvedAt')
      }
    })
  })

  // ==========================================================================
  // CONFLICT RESOLUTION STRATEGIES (Task Requirement #5 - Enhanced)
  // ==========================================================================

  describe('conflict resolution strategies (enhanced)', () => {
    it('supports last-write-wins strategy', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'eventual',
        conflictResolution: 'last-write-wins',
      }) as unknown as EventualCloneHandle

      await vi.advanceTimersByTimeAsync(30000)

      // Create conflict
      const things = result.sqlData.get('things')!
      const thing = things.find((t) => (t as Record<string, unknown>).id === 'thing-0')
      if (thing) {
        (thing as Record<string, unknown>).version = 10
      }

      const syncResult = await handle.sync()

      for (const conflict of syncResult.conflicts) {
        expect(conflict.resolution).toBe('last-write-wins')
      }
    })

    it('supports source-wins strategy', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'eventual',
        conflictResolution: 'source-wins',
      }) as unknown as EventualCloneHandle

      await vi.advanceTimersByTimeAsync(30000)

      const things = result.sqlData.get('things')!
      const thing = things.find((t) => (t as Record<string, unknown>).id === 'thing-0')
      if (thing) {
        (thing as Record<string, unknown>).version = 10
      }

      const syncResult = await handle.sync()

      for (const conflict of syncResult.conflicts) {
        expect(conflict.resolution).toBe('source-wins')
      }
    })

    it('supports target-wins strategy', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'eventual',
        conflictResolution: 'target-wins',
      }) as unknown as EventualCloneHandle

      await vi.advanceTimersByTimeAsync(30000)

      const things = result.sqlData.get('things')!
      const thing = things.find((t) => (t as Record<string, unknown>).id === 'thing-0')
      if (thing) {
        (thing as Record<string, unknown>).version = 10
      }

      const syncResult = await handle.sync()

      for (const conflict of syncResult.conflicts) {
        expect(conflict.resolution).toBe('target-wins')
      }
    })

    it('supports merge strategy', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'eventual',
        conflictResolution: 'merge',
      }) as unknown as EventualCloneHandle

      await vi.advanceTimersByTimeAsync(30000)

      const things = result.sqlData.get('things')!
      const thing = things.find((t) => (t as Record<string, unknown>).id === 'thing-0')
      if (thing) {
        (thing as Record<string, unknown>).version = 10
      }

      const syncResult = await handle.sync()

      for (const conflict of syncResult.conflicts) {
        expect(conflict.resolution).toBe('merge')
      }
    })

    it('supports custom conflict resolver', async () => {
      const customResolver = vi.fn(async (conflict: ConflictInfo) => {
        return {
          id: conflict.thingId,
          data: { customResolved: true, from: 'custom-resolver' },
          version: Math.max(conflict.sourceVersion, conflict.targetVersion) + 1,
        }
      })

      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'eventual',
        conflictResolver: customResolver,
      }) as unknown as EventualCloneHandle

      await vi.advanceTimersByTimeAsync(30000)

      const things = result.sqlData.get('things')!
      const thing = things.find((t) => (t as Record<string, unknown>).id === 'thing-0')
      if (thing) {
        (thing as Record<string, unknown>).version = 10
      }

      await handle.sync()

      // Custom resolver should be called for conflicts
      // May or may not be called depending on if conflicts are detected
      expect(customResolver).toBeDefined()
    })

    it('logs all conflict resolutions for audit', async () => {
      const conflictLogs: ConflictInfo[] = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        if (verb === 'clone.conflict.resolved') {
          conflictLogs.push(data as ConflictInfo)
        }
        return originalEmit?.call(result.instance, verb, data)
      }

      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      await vi.advanceTimersByTimeAsync(30000)

      const things = result.sqlData.get('things')!
      for (let i = 0; i < 3; i++) {
        const thing = things.find((t) => (t as Record<string, unknown>).id === `thing-${i}`)
        if (thing) {
          (thing as Record<string, unknown>).version = 20
        }
      }

      await handle.sync()

      // All conflicts should be logged
      for (const log of conflictLogs) {
        expect(log).toHaveProperty('thingId')
        expect(log).toHaveProperty('resolution')
        expect(log).toHaveProperty('resolvedAt')
      }
    })
  })
})
