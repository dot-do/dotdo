/**
 * LazyCheckpointer Thread Safety Tests (RED Phase)
 *
 * These tests focus on specific thread safety issues in LazyCheckpointer
 * that may not be caught by the general race condition tests.
 *
 * Key areas tested:
 * 1. Mutex acquisition race between getDirtyCount check and promise set
 * 2. Multiple waiters racing when checkpoint completes
 * 3. beforeHibernation/checkpoint interleaving
 * 4. Timer-triggered checkpoint vs manual checkpoint race
 * 5. Version counter overflow/wrap behavior
 *
 * @see storage/lazy-checkpointer.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  LazyCheckpointer,
  DirtyTracker,
  DirtyEntry,
  CheckpointStats,
} from '../../storage/lazy-checkpointer'

// =============================================================================
// Test Infrastructure
// =============================================================================

interface SqlWriteRecord {
  timestamp: number
  key: string
  type: string
  data: string
  threadId: string
}

/**
 * Creates a mock SQL storage with configurable async delays
 */
function createAsyncMockSql() {
  const writes: SqlWriteRecord[] = []
  let asyncDelay = 0
  let currentThreadId = 'main'
  let transactionDepth = 0
  const transactionLog: Array<{ action: 'begin' | 'commit' | 'rollback'; threadId: string; timestamp: number }> = []

  return {
    writes,
    transactionLog,
    setAsyncDelay(ms: number) {
      asyncDelay = ms
    },
    setThreadId(id: string) {
      currentThreadId = id
    },
    getTransactionDepth() {
      return transactionDepth
    },
    exec(query: string, ...params: unknown[]) {
      const timestamp = Date.now()

      if (query === 'BEGIN TRANSACTION') {
        transactionDepth++
        transactionLog.push({ action: 'begin', threadId: currentThreadId, timestamp })
      } else if (query === 'COMMIT') {
        transactionDepth--
        transactionLog.push({ action: 'commit', threadId: currentThreadId, timestamp })
      } else if (query === 'ROLLBACK') {
        transactionDepth--
        transactionLog.push({ action: 'rollback', threadId: currentThreadId, timestamp })
      } else if (query.includes('INSERT OR REPLACE')) {
        const [key, type, data] = params as [string, string, string]
        writes.push({
          timestamp,
          key,
          type,
          data,
          threadId: currentThreadId,
        })

        // Simulate async I/O with busy wait (to keep control flow predictable)
        if (asyncDelay > 0) {
          const start = Date.now()
          while (Date.now() - start < asyncDelay) {
            // Busy wait
          }
        }
      }
      return { toArray: () => [] }
    },
  }
}

/**
 * Creates a mock dirty tracker with concurrent modification capabilities
 */
function createConcurrentDirtyTracker() {
  const dirtyEntries = new Map<string, DirtyEntry>()
  const clearedKeys: string[][] = []
  const accessLog: Array<{ method: string; timestamp: number; keys?: string[] }> = []
  let memoryUsage = 0

  return {
    dirtyEntries,
    clearedKeys,
    accessLog,

    setDirty(key: string, type: string, data: unknown) {
      const entry: DirtyEntry = {
        type,
        data,
        size: JSON.stringify(data).length,
      }
      dirtyEntries.set(key, entry)
      memoryUsage += entry.size
      accessLog.push({ method: 'setDirty', timestamp: Date.now(), keys: [key] })
    },

    getDirtyEntries(): Map<string, DirtyEntry> {
      accessLog.push({ method: 'getDirtyEntries', timestamp: Date.now() })
      // Return a live reference to expose race conditions
      return dirtyEntries
    },

    getDirtyCount(): number {
      accessLog.push({ method: 'getDirtyCount', timestamp: Date.now() })
      return dirtyEntries.size
    },

    getMemoryUsage(): number {
      return memoryUsage
    },

    clearDirty(keys: string[]): void {
      accessLog.push({ method: 'clearDirty', timestamp: Date.now(), keys: [...keys] })
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
      accessLog.length = 0
    },
  }
}

// =============================================================================
// Thread Safety: Mutex Acquisition Race
// =============================================================================

describe('LazyCheckpointer Thread Safety', () => {
  describe('mutex acquisition race window', () => {
    it('should not allow two checkpoints to both see dirty entries and both try to write', async () => {
      /**
       * RACE CONDITION: Between getDirtyCount() check (line 268) and setting
       * _checkpointPromise (line 280), another call could also pass the check.
       *
       * Timeline:
       * T1: checkpoint() called
       * T1: getDirtyCount() returns 5, enters "acquire mutex" branch
       * T2: checkpoint() called (before T1 sets _checkpointPromise)
       * T2: _checkpointPromise is still null, getDirtyCount() returns 5
       * T2: Also enters "acquire mutex" branch
       * T1: Sets _checkpointPromise
       * T2: Sets _checkpointPromise (overwrites T1's!)
       *
       * Result: Both T1 and T2 run doCheckpointInternal, corrupting state
       */
      const sql = createAsyncMockSql()
      const tracker = createConcurrentDirtyTracker()

      // Add entries
      for (let i = 0; i < 5; i++) {
        tracker.setDirty(`entry-${i}`, 'Test', { value: i })
      }

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker: tracker,
        intervalMs: 60000,
      })

      // Track how many times doCheckpointInternal actually executes
      // by counting BEGIN TRANSACTION calls
      sql.setAsyncDelay(1) // Small delay to widen race window

      // Launch checkpoints in tight loop
      const checkpoints: Promise<CheckpointStats>[] = []
      for (let i = 0; i < 10; i++) {
        sql.setThreadId(`thread-${i}`)
        checkpoints.push(checkpointer.checkpoint())
      }

      const results = await Promise.all(checkpoints)

      // Count total entries written
      const totalWritten = results.reduce((sum, s) => sum + s.entriesWritten, 0)

      // ASSERTION: Total entries written should be exactly 5
      // If race exists, we might see duplicates (>5) or missed entries (<5)
      expect(totalWritten).toBe(5)

      // Count BEGIN TRANSACTION calls - should be exactly 1 with proper mutex
      const beginCount = sql.transactionLog.filter(l => l.action === 'begin').length
      expect(beginCount).toBe(1)
    })

    it('should prevent mutex acquisition between dirtyCount check and promise assignment', async () => {
      /**
       * This test verifies that the critical section between checking dirty count
       * and assigning _checkpointPromise is atomic (cannot be interrupted).
       *
       * We inject a yield point to simulate context switch between these operations.
       */
      const sql = createAsyncMockSql()
      const tracker = createConcurrentDirtyTracker()

      tracker.setDirty('k1', 'T', { v: 1 })
      tracker.setDirty('k2', 'T', { v: 2 })

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker: tracker,
        intervalMs: 60000,
      })

      // Create a scenario where multiple calls race at the mutex acquisition point
      const p1 = checkpointer.checkpoint()
      const p2 = checkpointer.checkpoint()
      const p3 = checkpointer.checkpoint()

      // Allow microtasks to run between each call
      await Promise.resolve()

      const p4 = checkpointer.checkpoint()
      const p5 = checkpointer.checkpoint()

      const results = await Promise.all([p1, p2, p3, p4, p5])

      // Only ONE checkpoint should have written entries
      const writeCounts = results.map(r => r.entriesWritten)
      const nonZeroWrites = writeCounts.filter(c => c > 0)

      // Exactly one checkpoint should have done work
      expect(nonZeroWrites.length).toBe(1)
      expect(nonZeroWrites[0]).toBe(2)
    })
  })

  describe('multiple waiters racing on completion', () => {
    it('should not have multiple waiters all race to start new checkpoint', async () => {
      /**
       * RACE CONDITION: When checkpoint completes and _checkpointPromise is cleared,
       * multiple waiting calls wake up and all call getDirtyCount() / checkpoint()
       * recursively. They all see dirty entries and try to acquire the mutex.
       *
       * Current implementation has waiters do:
       *   return existingPromise.then(() => {
       *     if (this.dirtyTracker.getDirtyCount() > 0) {
       *       return this.checkpoint() // ALL waiters call this!
       *     }
       *   })
       */
      const sql = createAsyncMockSql()
      const tracker = createConcurrentDirtyTracker()

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker: tracker,
        intervalMs: 60000,
      })

      // Add initial entries
      tracker.setDirty('initial-1', 'T', { v: 1 })

      sql.setAsyncDelay(5) // Make checkpoint slow

      // Start first checkpoint
      const p1 = checkpointer.checkpoint()

      // Wait a bit then queue up more entries and waiters
      await new Promise(r => setTimeout(r, 2))

      // Add more entries while first checkpoint runs
      tracker.setDirty('new-1', 'T', { v: 2 })
      tracker.setDirty('new-2', 'T', { v: 3 })

      // Start multiple waiting checkpoints
      const waiters = Array.from({ length: 20 }, () => checkpointer.checkpoint())

      const [firstResult, ...waiterResults] = await Promise.all([p1, ...waiters])

      // First checkpoint writes initial entry
      expect(firstResult.entriesWritten).toBe(1)

      // Among all waiters, exactly 2 more entries should be written total
      const totalWaiterWrites = waiterResults.reduce((sum, r) => sum + r.entriesWritten, 0)
      expect(totalWaiterWrites).toBe(2)

      // No duplicate writes should occur
      const allKeys = sql.writes.map(w => w.key)
      const uniqueKeys = new Set(allKeys)
      expect(uniqueKeys.size).toBe(allKeys.length)
    })

    it('should serialize recursive checkpoint calls from waiters', async () => {
      /**
       * When multiple waiters wake up and find dirty entries, they should
       * NOT all start their own checkpoints - only one should proceed.
       */
      const sql = createAsyncMockSql()
      const tracker = createConcurrentDirtyTracker()

      // Track checkpoint execution order
      const executionLog: string[] = []

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker: tracker,
        intervalMs: 60000,
        onCheckpoint: (stats) => {
          executionLog.push(`complete:${stats.entriesWritten}`)
        },
      })

      // Add initial entry
      tracker.setDirty('k1', 'T', { v: 1 })

      // Intercept to track checkpoint starts
      const originalGetDirtyEntries = tracker.getDirtyEntries.bind(tracker)
      let getDirtyCallCount = 0
      tracker.getDirtyEntries = function() {
        getDirtyCallCount++
        executionLog.push(`getDirtyEntries:${getDirtyCallCount}`)
        return originalGetDirtyEntries()
      }

      sql.setAsyncDelay(2)

      // Start first checkpoint
      const p1 = checkpointer.checkpoint()

      // Queue up 5 waiters
      const waiters = Array.from({ length: 5 }, () => checkpointer.checkpoint())

      // While waiters are queued, add more entries
      tracker.setDirty('k2', 'T', { v: 2 })

      await Promise.all([p1, ...waiters])

      // Analysis: getDirtyEntries should be called a limited number of times
      // With perfect serialization: 2 times (one per actual checkpoint)
      // With race condition: could be many more (each waiter calls it)

      // Count actual BEGIN TRANSACTION calls
      const beginCount = sql.transactionLog.filter(l => l.action === 'begin').length

      // Should be exactly 2: one for k1, one for k2
      expect(beginCount).toBe(2)
    })
  })

  describe('beforeHibernation and checkpoint interleaving', () => {
    it('should not interleave beforeHibernation with concurrent checkpoint', async () => {
      /**
       * RACE: If checkpoint() is called, then immediately beforeHibernation():
       *
       * T1: checkpoint() - checks _checkpointPromise (null), about to set it
       * T2: beforeHibernation() - checks _checkpointPromise (still null!)
       * T1: Sets _checkpointPromise, starts doCheckpointInternal
       * T2: Also sets _checkpointPromise (overwrites T1!), starts doCheckpointInternal
       *
       * Both run concurrently, corrupting state.
       */
      const sql = createAsyncMockSql()
      const tracker = createConcurrentDirtyTracker()

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker: tracker,
        intervalMs: 60000,
      })

      // Add entries
      for (let i = 0; i < 10; i++) {
        tracker.setDirty(`entry-${i}`, 'Entry', { value: i })
      }

      sql.setAsyncDelay(2)

      // Call both as close together as possible
      sql.setThreadId('manual')
      const manualPromise = checkpointer.checkpoint()

      sql.setThreadId('hibernation')
      const hibernationPromise = checkpointer.beforeHibernation()

      const [manualStats, hibernationStats] = await Promise.all([
        manualPromise,
        hibernationPromise,
      ])

      // Total entries written should be exactly 10
      const totalWritten = manualStats.entriesWritten + hibernationStats.entriesWritten
      expect(totalWritten).toBe(10)

      // No duplicate writes
      const uniqueKeys = new Set(sql.writes.map(w => w.key))
      expect(uniqueKeys.size).toBe(10)

      // No interleaved transactions
      const transactions = sql.transactionLog
      let depth = 0
      let maxDepth = 0
      for (const log of transactions) {
        if (log.action === 'begin') {
          depth++
          maxDepth = Math.max(maxDepth, depth)
        } else {
          depth--
        }
      }

      // Max transaction depth should be 1 (no concurrent transactions)
      expect(maxDepth).toBe(1)
    })

    it('should complete hibernation even if checkpoint errors', async () => {
      /**
       * RED TEST: If a concurrent checkpoint throws, beforeHibernation should still
       * complete its work to ensure data is persisted before eviction.
       *
       * Current bug: When checkpoint fails, beforeHibernation waits for it but
       * doesn't properly handle the error and retry. Data may be lost before
       * DO eviction.
       */
      const tracker = createConcurrentDirtyTracker()
      let failCount = 0

      const failingSql = {
        exec(query: string, ...params: unknown[]) {
          if (query === 'BEGIN TRANSACTION' || query === 'COMMIT' || query === 'ROLLBACK') {
            return { toArray: () => [] }
          }
          if (query.includes('INSERT') && failCount < 1) {
            failCount++
            throw new Error('Simulated SQL error')
          }
          return { toArray: () => [] }
        },
      }

      const checkpointer = new LazyCheckpointer({
        sql: failingSql,
        dirtyTracker: tracker,
        intervalMs: 60000,
      })

      tracker.setDirty('k1', 'T', { v: 1 })
      tracker.setDirty('k2', 'T', { v: 2 })

      // First checkpoint will fail
      const checkpointPromise = checkpointer.checkpoint().catch(() => ({
        entriesWritten: 0,
        bytesWritten: 0,
        durationMs: 0,
        trigger: 'manual' as const,
      }))

      // Hibernation should still work even if checkpoint failed
      // This is critical - data MUST be persisted before hibernation
      const hibernationPromise = checkpointer.beforeHibernation().catch(() => ({
        entriesWritten: 0,
        bytesWritten: 0,
        durationMs: 0,
        trigger: 'hibernation' as const,
      }))

      const [checkpointStats, hibernationStats] = await Promise.all([
        checkpointPromise,
        hibernationPromise,
      ])

      // Checkpoint failed
      expect(checkpointStats.entriesWritten).toBe(0)

      // BUG: Hibernation should have succeeded with all entries
      // Current implementation fails because it waits for the failed checkpoint
      // and then the same error propagates
      expect(hibernationStats.entriesWritten).toBe(2)
    })
  })

  describe('timer-triggered checkpoint race', () => {
    it('should handle maybeCheckpoint racing with manual checkpoint', async () => {
      /**
       * RACE: Timer fires maybeCheckpoint() at same time as manual checkpoint():
       *
       * Timer: maybeCheckpoint('timer') - checks _checkpointPromise
       * Manual: checkpoint() - checks _checkpointPromise
       * Both see null and try to acquire mutex
       */
      const sql = createAsyncMockSql()
      const tracker = createConcurrentDirtyTracker()

      // Very short interval to trigger timer quickly
      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker: tracker,
        intervalMs: 10,
        dirtyCountThreshold: 5,
      })

      // Add entries
      for (let i = 0; i < 10; i++) {
        tracker.setDirty(`timer-${i}`, 'Timer', { value: i })
      }

      checkpointer.start()

      // Rapidly call manual checkpoints while timer might fire
      const manualCalls: Promise<CheckpointStats>[] = []
      for (let i = 0; i < 20; i++) {
        manualCalls.push(checkpointer.checkpoint())
        // Small delay to allow timer to potentially fire
        await new Promise(r => setTimeout(r, 1))
      }

      await Promise.all(manualCalls)

      checkpointer.stop()

      // All 10 entries should be written exactly once
      const uniqueKeys = new Set(sql.writes.map(w => w.key))
      expect(uniqueKeys.size).toBe(10)

      // No duplicate writes
      expect(sql.writes.length).toBe(10)
    })

    it('should handle notifyDirty triggering threshold checkpoint while manual runs', async () => {
      /**
       * RACE: notifyDirty() triggers threshold checkpoint while manual is running
       */
      const sql = createAsyncMockSql()
      const tracker = createConcurrentDirtyTracker()

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker: tracker,
        intervalMs: 60000,
        dirtyCountThreshold: 3, // Low threshold
      })

      // Add initial entries
      tracker.setDirty('k1', 'T', { v: 1 })
      tracker.setDirty('k2', 'T', { v: 2 })

      sql.setAsyncDelay(5)

      // Start manual checkpoint
      const manualPromise = checkpointer.checkpoint()

      // While it runs, add entries to trigger threshold
      tracker.setDirty('k3', 'T', { v: 3 })
      tracker.setDirty('k4', 'T', { v: 4 })
      tracker.setDirty('k5', 'T', { v: 5 })

      // Notify dirty to trigger threshold check
      checkpointer.notifyDirty()

      // Also call checkpoint manually
      const manualPromise2 = checkpointer.checkpoint()

      await Promise.all([manualPromise, manualPromise2])

      // Final checkpoint to ensure all are written
      await checkpointer.checkpoint()

      // All 5 entries should be written exactly once
      const uniqueKeys = new Set(sql.writes.map(w => w.key))
      expect(uniqueKeys.size).toBe(5)
    })
  })

  describe('version counter edge cases', () => {
    it('should handle version counter wraparound safely', async () => {
      /**
       * The currentVersion counter could theoretically overflow if many writes occur.
       * This shouldn't cause issues in JavaScript (numbers are 64-bit floats),
       * but we should verify behavior near MAX_SAFE_INTEGER.
       */
      const sql = createAsyncMockSql()
      const tracker = createConcurrentDirtyTracker()

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker: tracker,
        intervalMs: 60000,
      })

      // Set currentVersion near MAX_SAFE_INTEGER
      // @ts-expect-error - accessing private for test
      checkpointer.currentVersion = Number.MAX_SAFE_INTEGER - 5

      // Add and write entries across the overflow boundary
      for (let i = 0; i < 10; i++) {
        tracker.setDirty(`overflow-${i}`, 'T', { value: i })
        checkpointer.trackWrite(`overflow-${i}`)
      }

      const stats = await checkpointer.checkpoint()

      // All entries should be written
      expect(stats.entriesWritten).toBe(10)

      // @ts-expect-error - accessing private for test
      const finalVersion = checkpointer.currentVersion

      // Version should have increased correctly
      expect(finalVersion).toBeGreaterThan(Number.MAX_SAFE_INTEGER)
    })

    it('should correctly compare versions for entries modified during checkpoint', async () => {
      /**
       * The version comparison logic:
       *   const writeVersion = this.writeVersions.get(key) ?? 0
       *   if (writeVersion <= checkpointVersion)
       *
       * This should correctly identify entries modified during checkpoint.
       */
      const sql = createAsyncMockSql()
      const tracker = createConcurrentDirtyTracker()
      let writesIntercepted = 0

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker: tracker,
        intervalMs: 60000,
      })

      // Add initial entries
      tracker.setDirty('v1', 'T', { value: 'original-1' })
      tracker.setDirty('v2', 'T', { value: 'original-2' })
      tracker.setDirty('v3', 'T', { value: 'original-3' })
      checkpointer.trackWrite('v1')
      checkpointer.trackWrite('v2')
      checkpointer.trackWrite('v3')

      // Intercept writes to modify entry mid-checkpoint
      const originalExec = sql.exec.bind(sql)
      sql.exec = function(query: string, ...params: unknown[]) {
        if (query.includes('INSERT') && writesIntercepted === 1) {
          // After first write, modify v3
          tracker.setDirty('v3', 'T', { value: 'modified-3' })
          checkpointer.trackWrite('v3')
        }
        writesIntercepted++
        return originalExec(query, ...params)
      }

      await checkpointer.checkpoint()

      // v3 should still be dirty (modified during checkpoint)
      expect(tracker.getDirtyCount()).toBe(1)
      const remaining = Array.from(tracker.dirtyEntries.keys())
      expect(remaining).toContain('v3')

      // Second checkpoint should write the modified value
      await checkpointer.checkpoint()

      expect(tracker.getDirtyCount()).toBe(0)

      // Find the final v3 write
      const v3Writes = sql.writes.filter(w => w.key === 'v3')
      expect(v3Writes.length).toBe(2) // Written twice (original + modified)

      const lastV3 = v3Writes[v3Writes.length - 1]
      const data = JSON.parse(lastV3.data)
      expect(data.value).toBe('modified-3')
    })
  })

  describe('promise state consistency', () => {
    it('should not leak promise state on error', async () => {
      /**
       * If doCheckpointInternal throws, _checkpointPromise should be properly cleared.
       * Otherwise, subsequent checkpoint calls will wait forever.
       */
      const tracker = createConcurrentDirtyTracker()
      let failCount = 0

      const failingSql = {
        exec(query: string) {
          if (query === 'BEGIN TRANSACTION') {
            return { toArray: () => [] }
          }
          if (query.includes('INSERT') && failCount < 3) {
            failCount++
            throw new Error(`Simulated failure ${failCount}`)
          }
          return { toArray: () => [] }
        },
      }

      const checkpointer = new LazyCheckpointer({
        sql: failingSql,
        dirtyTracker: tracker,
        intervalMs: 60000,
      })

      tracker.setDirty('k1', 'T', { v: 1 })

      // First checkpoint fails
      await expect(checkpointer.checkpoint()).rejects.toThrow()

      // Check that _checkpointPromise is cleared
      // @ts-expect-error - accessing private for test
      expect(checkpointer._checkpointPromise).toBeNull()
      // @ts-expect-error - accessing private for test
      expect(checkpointer.checkpointInProgress).toBe(false)

      // Second checkpoint should not hang
      tracker.setDirty('k2', 'T', { v: 2 })

      // This should complete (not hang waiting for stale promise)
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Checkpoint hung')), 1000)
      )

      await expect(
        Promise.race([checkpointer.checkpoint().catch(() => 'handled'), timeoutPromise])
      ).resolves.toBeDefined()
    })

    it('should handle multiple concurrent errors correctly', async () => {
      /**
       * If multiple callers are waiting and the checkpoint errors,
       * all waiters should receive the error or retry correctly.
       */
      const tracker = createConcurrentDirtyTracker()
      let shouldFail = true

      const sometimesFailingSql = {
        exec(query: string) {
          if (query === 'BEGIN TRANSACTION' || query === 'ROLLBACK') {
            return { toArray: () => [] }
          }
          if (query.includes('INSERT') && shouldFail) {
            throw new Error('SQL error')
          }
          return { toArray: () => [] }
        },
      }

      const checkpointer = new LazyCheckpointer({
        sql: sometimesFailingSql,
        dirtyTracker: tracker,
        intervalMs: 60000,
      })

      tracker.setDirty('k1', 'T', { v: 1 })

      // Launch multiple concurrent checkpoints
      const promises = Array.from({ length: 5 }, () =>
        checkpointer.checkpoint().catch(e => ({ error: e.message }))
      )

      const results = await Promise.all(promises)

      // At least one should have failed
      const errors = results.filter(r => 'error' in r)
      expect(errors.length).toBeGreaterThan(0)

      // Now make SQL work
      shouldFail = false

      // New checkpoint should succeed
      tracker.setDirty('k2', 'T', { v: 2 })
      const stats = await checkpointer.checkpoint()

      // Should have written at least k2
      expect(stats.entriesWritten).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Map iteration safety during concurrent modification', () => {
    it('should handle entries added to dirtyEntries during iteration', async () => {
      /**
       * The getDirtyEntries() returns a live Map. If entries are added
       * during iteration (for...of), the iteration behavior is undefined.
       *
       * JavaScript Map iteration visits entries added after iteration starts,
       * but this can cause inconsistent behavior.
       */
      const sql = createAsyncMockSql()
      const tracker = createConcurrentDirtyTracker()
      let iterationStarted = false

      // Modify the getDirtyEntries to add entries during iteration
      const originalGetDirtyEntries = tracker.getDirtyEntries.bind(tracker)
      tracker.getDirtyEntries = function() {
        const map = originalGetDirtyEntries()

        // Add entries during iteration (simulate concurrent write)
        if (!iterationStarted) {
          iterationStarted = true
          // Schedule addition during iteration
          queueMicrotask(() => {
            tracker.setDirty('injected-1', 'T', { injected: true })
            tracker.setDirty('injected-2', 'T', { injected: true })
          })
        }

        return map
      }

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker: tracker,
        intervalMs: 60000,
      })

      // Add initial entries
      for (let i = 0; i < 5; i++) {
        tracker.setDirty(`initial-${i}`, 'T', { initial: i })
      }

      await checkpointer.checkpoint()
      await checkpointer.checkpoint() // Second pass for any injected entries

      // Verify initial entries were written
      const initialKeys = sql.writes.filter(w => w.key.startsWith('initial-'))
      expect(initialKeys.length).toBe(5)

      // Injected entries should either be written or left dirty for next checkpoint
      // (behavior depends on iteration order and timing)
    })

    it('should handle entries deleted from dirtyEntries during iteration', async () => {
      /**
       * If clearDirty is called while iterating dirtyEntries (perhaps from
       * another async operation), iteration should not crash.
       */
      const sql = createAsyncMockSql()
      const tracker = createConcurrentDirtyTracker()

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker: tracker,
        intervalMs: 60000,
      })

      // Add many entries
      for (let i = 0; i < 20; i++) {
        tracker.setDirty(`key-${i}`, 'T', { value: i })
      }

      // Intercept SQL writes to delete entries mid-iteration
      const originalExec = sql.exec.bind(sql)
      let deleteTriggered = false
      sql.exec = function(query: string, ...params: unknown[]) {
        if (query.includes('INSERT') && !deleteTriggered) {
          deleteTriggered = true
          // Simulate external clear of some entries
          tracker.clearDirty(['key-15', 'key-16', 'key-17'])
        }
        return originalExec(query, ...params)
      }

      // This should not throw despite concurrent modification
      const stats = await checkpointer.checkpoint()

      // Most entries should have been written (exact count depends on timing)
      expect(stats.entriesWritten).toBeGreaterThan(0)

      // Second checkpoint to ensure all are eventually written
      await checkpointer.checkpoint()

      // Verify no crashes occurred and state is consistent
      expect(tracker.getDirtyCount()).toBe(0)
    })
  })

  describe('checkpoint deduplication', () => {
    it('should deduplicate rapid checkpoint calls', async () => {
      /**
       * When checkpoint() is called multiple times in quick succession,
       * the implementation should deduplicate to avoid redundant work.
       */
      const sql = createAsyncMockSql()
      const tracker = createConcurrentDirtyTracker()

      tracker.setDirty('k1', 'T', { v: 1 })

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker: tracker,
        intervalMs: 60000,
      })

      sql.setAsyncDelay(10)

      // Rapid-fire checkpoint calls
      const promises: Promise<CheckpointStats>[] = []
      for (let i = 0; i < 50; i++) {
        promises.push(checkpointer.checkpoint())
      }

      const results = await Promise.all(promises)

      // Only one should have actually written
      const writeCounts = results.filter(r => r.entriesWritten > 0)
      expect(writeCounts.length).toBe(1)

      // SQL should show only one write
      expect(sql.writes.length).toBe(1)
    })

    it('should handle recursive checkpoint from waiter correctly', async () => {
      /**
       * RED TEST: When a waiter wakes up and finds dirty entries, it calls checkpoint()
       * recursively. The waiter should correctly report entries it wrote.
       *
       * Current bug: The waiter's recursive checkpoint may not properly propagate
       * the entries written count, or multiple waiters may race to handle the
       * new entries.
       */
      const sql = createAsyncMockSql()
      const tracker = createConcurrentDirtyTracker()
      const checkpointCalls: number[] = []

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker: tracker,
        intervalMs: 60000,
        onCheckpoint: (stats) => {
          checkpointCalls.push(stats.entriesWritten)
        },
      })

      // Initial entry
      tracker.setDirty('first', 'T', { v: 1 })

      sql.setAsyncDelay(10) // Longer delay to ensure waiter is queued

      // Start checkpoint
      const p1 = checkpointer.checkpoint()

      // Ensure p1 has started (mutex acquired)
      await new Promise(r => setTimeout(r, 1))

      // Queue a waiter
      const p2 = checkpointer.checkpoint()

      // Add entry while checkpoint runs (so waiter finds dirty entries when it wakes)
      await new Promise(r => setTimeout(r, 3))
      tracker.setDirty('second', 'T', { v: 2 })

      const [r1, r2] = await Promise.all([p1, p2])

      // First should write 'first'
      expect(r1.entriesWritten).toBe(1)

      // The waiter (p2) should have recursively handled 'second'
      // BUG: Current implementation may return 0 because the recursive call's
      // result isn't properly attributed to the waiter
      expect(r2.entriesWritten).toBe(1)

      // Verify all entries were written (regardless of which checkpoint claimed them)
      const uniqueKeys = new Set(sql.writes.map(w => w.key))
      expect(uniqueKeys.size).toBe(2)
    })
  })
})
