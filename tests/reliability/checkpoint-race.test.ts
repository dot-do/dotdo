/**
 * LazyCheckpointer Race Condition Tests (RED Phase)
 *
 * These tests verify that LazyCheckpointer properly handles concurrent operations.
 * Tests are designed to FAIL initially, exposing the lack of proper locking/mutex.
 *
 * Race conditions identified:
 * 1. No mutex/lock around doCheckpoint - concurrent calls can corrupt state
 * 2. Dirty flags can be cleared while another checkpoint is iterating
 * 3. Version tracking is not atomic with checkpoint operations
 * 4. SQLite writes can interleave between concurrent checkpoints
 *
 * @see https://github.com/dotdo/dotdo/issues/do-3dg
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  LazyCheckpointer,
  DirtyTracker,
  DirtyEntry,
  CheckpointStats,
} from '../../storage/lazy-checkpointer'

// =============================================================================
// Mock Infrastructure
// =============================================================================

interface SqlWriteRecord {
  timestamp: number
  key: string
  type: string
  data: string
  checkpointId: string
}

/**
 * Mock SQL storage that tracks writes with timestamps for race detection
 */
function createMockSql() {
  const writes: SqlWriteRecord[] = []
  let writeDelay = 0
  let currentCheckpointId = ''

  return {
    writes,
    setWriteDelay(ms: number) {
      writeDelay = ms
    },
    setCheckpointId(id: string) {
      currentCheckpointId = id
    },
    exec(query: string, ...params: unknown[]) {
      if (query.includes('INSERT OR REPLACE')) {
        const [key, type, data] = params as [string, string, string]
        writes.push({
          timestamp: Date.now(),
          key,
          type,
          data,
          checkpointId: currentCheckpointId,
        })

        // Simulate slow I/O to increase race window
        if (writeDelay > 0) {
          const start = Date.now()
          while (Date.now() - start < writeDelay) {
            // Busy wait to simulate blocking I/O
          }
        }
      }
      return { toArray: () => [] }
    },
  }
}

/**
 * Mock dirty tracker that allows simulation of concurrent modifications
 */
function createMockDirtyTracker() {
  const dirtyEntries = new Map<string, DirtyEntry>()
  const clearedKeys: string[][] = [] // Track each clearDirty call
  let memoryUsage = 0

  return {
    dirtyEntries,
    clearedKeys,

    setDirty(key: string, type: string, data: unknown) {
      const entry: DirtyEntry = {
        type,
        data,
        size: JSON.stringify(data).length,
      }
      dirtyEntries.set(key, entry)
      memoryUsage += entry.size
    },

    getDirtyEntries(): Map<string, DirtyEntry> {
      // Return a live reference (not a copy) to expose race conditions
      return dirtyEntries
    },

    getDirtyCount(): number {
      return dirtyEntries.size
    },

    getMemoryUsage(): number {
      return memoryUsage
    },

    clearDirty(keys: string[]): void {
      clearedKeys.push([...keys])
      for (const key of keys) {
        const entry = dirtyEntries.get(key)
        if (entry) {
          memoryUsage -= entry.size
          dirtyEntries.delete(key)
        }
      }
    },

    clear(): void {
      dirtyEntries.clear()
      memoryUsage = 0
    },
  }
}

// =============================================================================
// Race Condition Tests - Concurrent Checkpoint Calls
// =============================================================================

describe('LazyCheckpointer Race Conditions', () => {
  describe('concurrent checkpoint calls', () => {
    it('should NOT allow concurrent checkpoints to corrupt data', async () => {
      /**
       * Test: Two concurrent checkpoint() calls should not cause data corruption.
       *
       * Expected behavior (with proper locking):
       * - Only one checkpoint should run at a time
       * - All entries should be written exactly once
       * - No duplicate writes or missed entries
       *
       * Current bug: No mutex means both checkpoints read the same dirty entries
       * and may write duplicates or clear entries prematurely.
       */
      const sql = createMockSql()
      const tracker = createMockDirtyTracker()

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker: tracker,
        intervalMs: 60000, // Disable timer
      })

      // Add 10 dirty entries
      for (let i = 0; i < 10; i++) {
        tracker.setDirty(`key-${i}`, 'TestType', { value: i })
      }

      // Add small delay to SQL writes to widen race window
      sql.setWriteDelay(1)

      // Launch two checkpoints concurrently
      sql.setCheckpointId('checkpoint-1')
      const checkpoint1 = checkpointer.checkpoint()

      sql.setCheckpointId('checkpoint-2')
      const checkpoint2 = checkpointer.checkpoint()

      const [stats1, stats2] = await Promise.all([checkpoint1, checkpoint2])

      // With proper locking, total entries written should equal 10
      // Each entry should be written exactly once
      const totalEntriesWritten = stats1.entriesWritten + stats2.entriesWritten
      expect(totalEntriesWritten).toBe(10)

      // Verify no duplicate writes
      const writtenKeys = sql.writes.map((w) => w.key)
      const uniqueKeys = new Set(writtenKeys)
      expect(uniqueKeys.size).toBe(writtenKeys.length)
    })

    it('should maintain atomicity - no partial checkpoint state', async () => {
      /**
       * Test: A checkpoint should be atomic - either all entries are written
       * and dirty flags cleared, or none are.
       *
       * Current bug: Entries can be written by one checkpoint while another
       * checkpoint clears the dirty flags, leading to inconsistent state.
       */
      const sql = createMockSql()
      const tracker = createMockDirtyTracker()
      const checkpointCallbacks: CheckpointStats[] = []

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker: tracker,
        intervalMs: 60000,
        onCheckpoint: (stats) => checkpointCallbacks.push(stats),
      })

      // Add 20 entries
      for (let i = 0; i < 20; i++) {
        tracker.setDirty(`atomic-${i}`, 'AtomicTest', { index: i })
      }

      // Run 3 concurrent checkpoints
      const checkpoints = await Promise.all([
        checkpointer.checkpoint(),
        checkpointer.checkpoint(),
        checkpointer.checkpoint(),
      ])

      // Each checkpoint callback should report consistent state
      // The sum of entriesWritten across all checkpoints should equal 20
      const totalReported = checkpoints.reduce((sum, s) => sum + s.entriesWritten, 0)
      expect(totalReported).toBe(20)

      // After all checkpoints, dirty count should be 0
      expect(tracker.getDirtyCount()).toBe(0)

      // Verify clearDirty was called with non-overlapping key sets
      const allClearedKeys = tracker.clearedKeys.flat()
      const uniqueClearedKeys = new Set(allClearedKeys)
      expect(uniqueClearedKeys.size).toBe(allClearedKeys.length)
    })

    it('should serialize checkpoint operations with proper locking', async () => {
      /**
       * Test: Checkpoints should be serialized - the second checkpoint should
       * wait for the first to complete.
       *
       * Current bug: Without a mutex, checkpoints run in parallel and can
       * see inconsistent state.
       */
      const sql = createMockSql()
      const tracker = createMockDirtyTracker()
      const checkpointOrder: string[] = []
      let checkpointCounter = 0

      // Wrap doCheckpoint to track execution order
      const originalExec = sql.exec.bind(sql)
      sql.exec = function (query: string, ...params: unknown[]) {
        if (query.includes('INSERT OR REPLACE')) {
          checkpointOrder.push(`write-${checkpointCounter}`)
        }
        return originalExec(query, ...params)
      }

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker: tracker,
        intervalMs: 60000,
        onCheckpoint: () => {
          checkpointOrder.push(`complete-${checkpointCounter++}`)
        },
      })

      // Add entries
      tracker.setDirty('k1', 'T', { v: 1 })
      tracker.setDirty('k2', 'T', { v: 2 })
      tracker.setDirty('k3', 'T', { v: 3 })

      // Add delay to SQL writes
      sql.setWriteDelay(2)

      // Launch concurrent checkpoints
      const p1 = checkpointer.checkpoint()
      const p2 = checkpointer.checkpoint()
      const p3 = checkpointer.checkpoint()

      await Promise.all([p1, p2, p3])

      // With proper locking, all writes from checkpoint 0 should complete
      // before checkpoint 1 starts. Check that completion events are sequential.
      const completeEvents = checkpointOrder.filter((e) => e.startsWith('complete-'))

      // If properly serialized, we should see sequential completion
      // (or only one checkpoint should have work to do)
      expect(completeEvents.length).toBeGreaterThanOrEqual(1)

      // The main assertion: no interleaved writes from different checkpoints
      // All writes should be grouped by checkpoint
      const writeGroups: number[] = []
      let currentGroup = -1

      for (const event of checkpointOrder) {
        if (event.startsWith('complete-')) {
          currentGroup = parseInt(event.split('-')[1])
          writeGroups.push(currentGroup)
        }
      }

      // Each checkpoint's writes should complete before the next starts
      // This means writeGroups should be monotonically non-decreasing
      for (let i = 1; i < writeGroups.length; i++) {
        expect(writeGroups[i]).toBeGreaterThanOrEqual(writeGroups[i - 1])
      }
    })
  })

  describe('dirty entry modification during checkpoint', () => {
    it('should handle new entries added during checkpoint', async () => {
      /**
       * Test: If a new entry is added while checkpoint is in progress,
       * it should not be lost or cause inconsistency.
       *
       * The version tracking should prevent clearing dirty flag for
       * entries modified during checkpoint, but concurrent reads of
       * dirtyEntries can still cause issues.
       */
      const sql = createMockSql()
      const tracker = createMockDirtyTracker()

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker: tracker,
        intervalMs: 60000,
      })

      // Add initial entries
      for (let i = 0; i < 5; i++) {
        tracker.setDirty(`initial-${i}`, 'Initial', { v: i })
        checkpointer.trackWrite(`initial-${i}`)
      }

      // Start checkpoint
      const checkpointPromise = checkpointer.checkpoint()

      // Immediately add more entries (simulating concurrent writes)
      for (let i = 0; i < 5; i++) {
        tracker.setDirty(`concurrent-${i}`, 'Concurrent', { v: i + 100 })
        checkpointer.trackWrite(`concurrent-${i}`)
      }

      await checkpointPromise

      // Run another checkpoint to pick up concurrent entries
      const stats2 = await checkpointer.checkpoint()

      // All 10 entries should eventually be checkpointed
      const allKeys = sql.writes.map((w) => w.key)
      expect(allKeys.length).toBe(10)

      // Verify both initial and concurrent entries were written
      const initialKeys = allKeys.filter((k) => k.startsWith('initial-'))
      const concurrentKeys = allKeys.filter((k) => k.startsWith('concurrent-'))

      expect(initialKeys.length).toBe(5)
      expect(concurrentKeys.length).toBe(5)
    })

    it('should not lose entries modified during checkpoint iteration', async () => {
      /**
       * Test: If an entry is modified while checkpoint is iterating over
       * dirty entries, the modification should not be lost.
       *
       * Current bug: The getDirtyEntries() returns a live Map reference.
       * If entries are modified during iteration, behavior is undefined.
       */
      const sql = createMockSql()
      const tracker = createMockDirtyTracker()

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker: tracker,
        intervalMs: 60000,
      })

      // Add initial entries
      for (let i = 0; i < 10; i++) {
        tracker.setDirty(`entry-${i}`, 'Test', { version: 1, index: i })
        checkpointer.trackWrite(`entry-${i}`)
      }

      // Intercept SQL writes to modify entries during checkpoint
      const originalExec = sql.exec.bind(sql)
      let modificationDone = false

      sql.exec = function (query: string, ...params: unknown[]) {
        const result = originalExec(query, ...params)

        // After first few writes, modify some entries
        if (!modificationDone && sql.writes.length >= 3) {
          modificationDone = true
          // Modify entries that may still be pending
          tracker.setDirty('entry-5', 'Test', { version: 2, index: 5 })
          tracker.setDirty('entry-7', 'Test', { version: 2, index: 7 })
          checkpointer.trackWrite('entry-5')
          checkpointer.trackWrite('entry-7')
        }

        return result
      }

      await checkpointer.checkpoint()

      // Run second checkpoint to catch modified entries
      await checkpointer.checkpoint()

      // Find the final values for entry-5 and entry-7
      const entry5Writes = sql.writes.filter((w) => w.key === 'entry-5')
      const entry7Writes = sql.writes.filter((w) => w.key === 'entry-7')

      // With proper handling, modified entries should be re-written
      // with version 2 (either in same checkpoint or next)
      const lastEntry5 = entry5Writes[entry5Writes.length - 1]
      const lastEntry7 = entry7Writes[entry7Writes.length - 1]

      const data5 = JSON.parse(lastEntry5.data)
      const data7 = JSON.parse(lastEntry7.data)

      expect(data5.version).toBe(2)
      expect(data7.version).toBe(2)
    })
  })

  describe('clearDirty race conditions', () => {
    it('should not clear dirty flags for entries being processed by another checkpoint', async () => {
      /**
       * Test: If checkpoint A is writing entry X, checkpoint B should not
       * be able to clear X's dirty flag before A finishes.
       *
       * Current bug: clearDirty operates on the same Map that checkpoints
       * are iterating, without synchronization.
       */
      const sql = createMockSql()
      const tracker = createMockDirtyTracker()

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker: tracker,
        intervalMs: 60000,
      })

      // Add entries
      for (let i = 0; i < 10; i++) {
        tracker.setDirty(`race-${i}`, 'Race', { i })
      }

      // Slow down SQL to create race window
      sql.setWriteDelay(5)

      // Launch concurrent checkpoints
      const checkpoints = await Promise.all([
        checkpointer.checkpoint(),
        checkpointer.checkpoint(),
      ])

      // Verify total entries written equals 10 (no double-clears causing missed writes)
      const totalWritten = checkpoints.reduce((sum, s) => sum + s.entriesWritten, 0)
      expect(totalWritten).toBe(10)

      // Each clearDirty call should have distinct keys
      const allClearedKeys = tracker.clearedKeys.flat()
      expect(new Set(allClearedKeys).size).toBe(allClearedKeys.length)
    })

    it('should handle clearDirty called while iterating dirtyEntries', async () => {
      /**
       * Test: Calling clearDirty while another checkpoint is iterating
       * the dirtyEntries Map should not cause iteration issues.
       *
       * This tests Map iteration behavior when entries are deleted during iteration.
       */
      const sql = createMockSql()
      const tracker = createMockDirtyTracker()

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker: tracker,
        intervalMs: 60000,
      })

      // Add 20 entries
      for (let i = 0; i < 20; i++) {
        tracker.setDirty(`iter-${i}`, 'Iter', { i })
      }

      // Launch many concurrent checkpoints to maximize collision chance
      const checkpoints = await Promise.all([
        checkpointer.checkpoint(),
        checkpointer.checkpoint(),
        checkpointer.checkpoint(),
        checkpointer.checkpoint(),
        checkpointer.checkpoint(),
      ])

      // All 20 entries should be written exactly once total
      const totalWritten = checkpoints.reduce((sum, s) => sum + s.entriesWritten, 0)
      expect(totalWritten).toBe(20)

      // No duplicate writes
      const allKeys = sql.writes.map((w) => w.key)
      expect(new Set(allKeys).size).toBe(20)

      // Dirty tracker should be empty
      expect(tracker.getDirtyCount()).toBe(0)
    })
  })

  describe('version tracking atomicity', () => {
    it('should atomically capture version and process entries', async () => {
      /**
       * Test: The checkpointVersion capture and subsequent version comparisons
       * should be atomic to prevent TOCTOU (time-of-check-time-of-use) races.
       *
       * Current bug: currentVersion is read, then later compared with writeVersions.
       * Between these operations, other writes can increment currentVersion.
       */
      const sql = createMockSql()
      const tracker = createMockDirtyTracker()

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker: tracker,
        intervalMs: 60000,
      })

      // Add initial entries
      for (let i = 0; i < 5; i++) {
        tracker.setDirty(`version-${i}`, 'Version', { v: 1 })
        checkpointer.trackWrite(`version-${i}`)
      }

      // Slow down to create race window
      sql.setWriteDelay(2)

      // Start checkpoint
      const checkpointPromise = checkpointer.checkpoint()

      // Immediately update entries (before checkpoint completes)
      for (let i = 0; i < 5; i++) {
        tracker.setDirty(`version-${i}`, 'Version', { v: 2 })
        checkpointer.trackWrite(`version-${i}`)
      }

      await checkpointPromise

      // Second checkpoint should pick up version 2 entries
      const stats2 = await checkpointer.checkpoint()

      // Get final values written
      const finalWrites = new Map<string, string>()
      for (const write of sql.writes) {
        finalWrites.set(write.key, write.data)
      }

      // All entries should have been written with version 2 eventually
      for (let i = 0; i < 5; i++) {
        const data = JSON.parse(finalWrites.get(`version-${i}`) || '{}')
        expect(data.v).toBe(2)
      }
    })

    it('should prevent clearing dirty flag when entry was modified during write', async () => {
      /**
       * Test: If an entry is modified between when we start writing it
       * and when we would clear its dirty flag, the flag should NOT be cleared.
       *
       * This is what the version tracking is supposed to prevent, but without
       * proper locking, the check can be defeated.
       */
      const sql = createMockSql()
      const tracker = createMockDirtyTracker()
      let writeCount = 0

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker: tracker,
        intervalMs: 60000,
      })

      tracker.setDirty('critical-entry', 'Critical', { value: 'original' })
      checkpointer.trackWrite('critical-entry')

      // Intercept SQL to modify entry mid-write
      const originalExec = sql.exec.bind(sql)
      sql.exec = function (query: string, ...params: unknown[]) {
        const result = originalExec(query, ...params)

        if (writeCount === 0 && query.includes('INSERT OR REPLACE')) {
          writeCount++
          // Modify the entry while it's being written
          tracker.setDirty('critical-entry', 'Critical', { value: 'modified' })
          checkpointer.trackWrite('critical-entry')
        }

        return result
      }

      await checkpointer.checkpoint()

      // The entry should still be dirty (because it was modified during checkpoint)
      expect(tracker.getDirtyCount()).toBe(1)

      // Second checkpoint should write the modified value
      await checkpointer.checkpoint()

      // Now it should be clean
      expect(tracker.getDirtyCount()).toBe(0)

      // Final written value should be 'modified'
      const lastWrite = sql.writes[sql.writes.length - 1]
      const data = JSON.parse(lastWrite.data)
      expect(data.value).toBe('modified')
    })
  })

  describe('hibernation flush race conditions', () => {
    it('should complete hibernation flush atomically', async () => {
      /**
       * Test: beforeHibernation() must complete all pending writes
       * before the DO is evicted. If concurrent operations are in progress,
       * they must all complete.
       *
       * Current bug: Without locking, beforeHibernation could return while
       * another checkpoint is still in progress.
       */
      const sql = createMockSql()
      const tracker = createMockDirtyTracker()

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker: tracker,
        intervalMs: 60000,
      })

      // Add entries
      for (let i = 0; i < 10; i++) {
        tracker.setDirty(`hibernate-${i}`, 'Hibernate', { i })
      }

      // Slow down writes
      sql.setWriteDelay(2)

      // Start a regular checkpoint, then immediately call hibernation
      const regularCheckpoint = checkpointer.checkpoint()
      const hibernationFlush = checkpointer.beforeHibernation()

      await Promise.all([regularCheckpoint, hibernationFlush])

      // After hibernation, ALL entries must be persisted
      expect(tracker.getDirtyCount()).toBe(0)

      // All 10 entries should be written
      const uniqueKeys = new Set(sql.writes.map((w) => w.key))
      expect(uniqueKeys.size).toBe(10)
    })

    it('should block new checkpoints after hibernation starts', async () => {
      /**
       * Test: Once beforeHibernation is called, no new checkpoint operations
       * should start until hibernation completes.
       *
       * This prevents the scenario where hibernation thinks it's done but
       * a concurrent checkpoint modified state.
       */
      const sql = createMockSql()
      const tracker = createMockDirtyTracker()
      const checkpointCalls: string[] = []

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker: tracker,
        intervalMs: 60000,
        onCheckpoint: (stats) => {
          checkpointCalls.push(stats.trigger)
        },
      })

      // Add entries
      tracker.setDirty('h1', 'H', { v: 1 })
      tracker.setDirty('h2', 'H', { v: 2 })

      sql.setWriteDelay(5)

      // Start hibernation
      const hibernation = checkpointer.beforeHibernation()

      // Try to start regular checkpoint during hibernation
      const manual = checkpointer.checkpoint()

      const [hibStats, manualStats] = await Promise.all([hibernation, manual])

      // With proper locking, these should be serialized
      // Total entries should be 2 (not duplicated)
      const totalWritten = hibStats.entriesWritten + manualStats.entriesWritten
      expect(totalWritten).toBe(2)

      // After all operations, dirty count should be 0
      expect(tracker.getDirtyCount()).toBe(0)
    })
  })

  describe('high concurrency stress tests', () => {
    it('should handle 100 concurrent checkpoint calls correctly', async () => {
      /**
       * Stress test: 100 concurrent checkpoint calls should not corrupt state
       * or lose data.
       *
       * With proper locking, only one should run at a time and subsequent
       * calls should either wait or return early (no dirty entries).
       */
      const sql = createMockSql()
      const tracker = createMockDirtyTracker()

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker: tracker,
        intervalMs: 60000,
      })

      // Add 50 entries
      for (let i = 0; i < 50; i++) {
        tracker.setDirty(`stress-${i}`, 'Stress', { i })
      }

      // Launch 100 concurrent checkpoints
      const checkpoints = Array.from({ length: 100 }, () => checkpointer.checkpoint())
      const results = await Promise.all(checkpoints)

      // Total entries written should equal 50 (no duplicates)
      const totalWritten = results.reduce((sum, s) => sum + s.entriesWritten, 0)
      expect(totalWritten).toBe(50)

      // Verify exactly 50 unique writes
      const uniqueKeys = new Set(sql.writes.map((w) => w.key))
      expect(uniqueKeys.size).toBe(50)

      // All dirty entries should be cleared
      expect(tracker.getDirtyCount()).toBe(0)
    })

    it('should handle interleaved writes and checkpoints', async () => {
      /**
       * Test: Rapid interleaving of writes and checkpoints should maintain
       * data integrity.
       */
      const sql = createMockSql()
      const tracker = createMockDirtyTracker()

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker: tracker,
        intervalMs: 60000,
      })

      const operations: Promise<unknown>[] = []

      // Interleave 20 writes with 10 checkpoints
      for (let i = 0; i < 30; i++) {
        if (i % 3 === 2) {
          operations.push(checkpointer.checkpoint())
        } else {
          const key = `interleave-${i}`
          tracker.setDirty(key, 'Interleave', { i })
          checkpointer.trackWrite(key)
          operations.push(Promise.resolve())
        }
      }

      await Promise.all(operations)

      // Final checkpoint to ensure all entries are written
      await checkpointer.checkpoint()

      // Count unique write keys (should be 20 entries from the writes)
      const writeKeys = sql.writes.map((w) => w.key)
      const uniqueWriteKeys = new Set(writeKeys)

      // Should have exactly 20 unique entries
      expect(uniqueWriteKeys.size).toBe(20)

      // No duplicates
      expect(writeKeys.length).toBe(uniqueWriteKeys.size)
    })
  })

  describe('mutex/lock implementation', () => {
    it('should have a mutex or lock to prevent concurrent checkpoints', async () => {
      /**
       * Test: The LazyCheckpointer should have a mutex/lock mechanism.
       * Without this, concurrent checkpoint calls WILL corrupt state.
       *
       * This test verifies that such a mechanism exists (it should fail
       * if there's no locking).
       */
      const sql = createMockSql()
      const tracker = createMockDirtyTracker()

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker: tracker,
        intervalMs: 60000,
      })

      // Check if there's a lock/mutex property
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cp = checkpointer as any

      // The implementation SHOULD have one of these:
      // - checkpointLock
      // - mutex
      // - checkpointInProgress flag
      // - pendingCheckpoint promise
      const hasLock =
        cp.checkpointLock !== undefined ||
        cp.mutex !== undefined ||
        cp.checkpointInProgress !== undefined ||
        cp.pendingCheckpoint !== undefined ||
        cp._checkpointPromise !== undefined

      expect(hasLock).toBe(true)
    })

    it('should return same promise when checkpoint is called twice concurrently', async () => {
      /**
       * Test: A proper implementation should deduplicate concurrent checkpoint
       * requests by returning the same promise.
       *
       * Current bug: Each call creates a new checkpoint operation.
       */
      const sql = createMockSql()
      const tracker = createMockDirtyTracker()

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker: tracker,
        intervalMs: 60000,
      })

      tracker.setDirty('k1', 'T', { v: 1 })

      // Make SQL slow to ensure both calls happen during same checkpoint
      sql.setWriteDelay(10)

      // Start two checkpoints "simultaneously"
      const p1 = checkpointer.checkpoint()
      const p2 = checkpointer.checkpoint()

      // With proper deduplication, these should be the same promise
      // or p2 should return immediately with 0 entries
      const [stats1, stats2] = await Promise.all([p1, p2])

      // Either: both return same promise (so stats are identical references)
      // Or: second returns 0 entries because first already handled it
      const isDeduped = stats1 === stats2 || stats2.entriesWritten === 0

      expect(isDeduped).toBe(true)
    })

    it('should track checkpoint state correctly across async boundaries', async () => {
      /**
       * Test: Checkpoint state tracking must be atomic across async operations.
       *
       * The version tracking in doCheckpoint snapshots checkpointVersion, then
       * does async work, then compares. This is a classic TOCTOU race.
       */
      const sql = createMockSql()
      const tracker = createMockDirtyTracker()
      let checkpointStartCount = 0

      // Patch to count checkpoint starts
      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker: tracker,
        intervalMs: 60000,
      })

      // Intercept dirty entries read to track when checkpoints start
      const originalGetDirty = tracker.getDirtyEntries.bind(tracker)
      tracker.getDirtyEntries = function () {
        checkpointStartCount++
        return originalGetDirty()
      }

      tracker.setDirty('k1', 'T', { v: 1 })
      tracker.setDirty('k2', 'T', { v: 2 })

      // Launch concurrent checkpoints
      await Promise.all([
        checkpointer.checkpoint(),
        checkpointer.checkpoint(),
        checkpointer.checkpoint(),
      ])

      // With proper locking, only ONE checkpoint should actually start
      // (others wait or return early before reading dirty entries)
      expect(checkpointStartCount).toBe(1)
    })
  })

  describe('checkpoint in-progress detection', () => {
    it('should provide way to check if checkpoint is in progress', async () => {
      /**
       * Test: There should be a mechanism to detect if a checkpoint is
       * currently running, to prevent concurrent checkpoint operations.
       *
       * Current implementation lacks this - this test documents the
       * expected behavior.
       */
      const sql = createMockSql()
      const tracker = createMockDirtyTracker()

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker: tracker,
        intervalMs: 60000,
      })

      tracker.setDirty('k1', 'T', { v: 1 })

      sql.setWriteDelay(10)

      // Start checkpoint
      const checkpointPromise = checkpointer.checkpoint()

      // There should be a way to check if checkpoint is in progress
      // This test expects a method like isCheckpointing() to exist
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cp = checkpointer as any

      // If isCheckpointing exists, it should return true during checkpoint
      if (typeof cp.isCheckpointing === 'function') {
        expect(cp.isCheckpointing()).toBe(true)
      } else {
        // Test fails - method doesn't exist
        expect(cp.isCheckpointing).toBeDefined()
      }

      await checkpointPromise
    })

    it('should queue checkpoints instead of running concurrently', async () => {
      /**
       * Test: When a checkpoint is requested while another is in progress,
       * it should be queued (or the request should wait), not run concurrently.
       *
       * Current bug: No queuing mechanism exists.
       */
      const sql = createMockSql()
      const tracker = createMockDirtyTracker()
      const startTimes: number[] = []
      const endTimes: number[] = []

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker: tracker,
        intervalMs: 60000,
        onCheckpoint: () => {
          endTimes.push(Date.now())
        },
      })

      // Intercept to track timing
      const originalExec = sql.exec.bind(sql)
      let firstWrite = true
      sql.exec = function (query: string, ...params: unknown[]) {
        if (firstWrite && query.includes('INSERT')) {
          firstWrite = false
          startTimes.push(Date.now())
        }
        return originalExec(query, ...params)
      }

      // Add entries
      for (let i = 0; i < 5; i++) {
        tracker.setDirty(`queue-${i}`, 'Queue', { i })
      }

      sql.setWriteDelay(5)

      // Launch checkpoints in quick succession
      const p1 = checkpointer.checkpoint()
      const p2 = checkpointer.checkpoint()

      await Promise.all([p1, p2])

      // With proper queuing, checkpoint 2 should start after checkpoint 1 ends
      // This means startTimes[1] >= endTimes[0] (if there are two starts)
      if (startTimes.length >= 2 && endTimes.length >= 1) {
        expect(startTimes[1]).toBeGreaterThanOrEqual(endTimes[0])
      }

      // Or there should only be one actual checkpoint execution
      // (second one should see no dirty entries)
      const totalWrites = sql.writes.length
      expect(totalWrites).toBe(5) // Exactly 5 entries, no duplicates
    })
  })
})
