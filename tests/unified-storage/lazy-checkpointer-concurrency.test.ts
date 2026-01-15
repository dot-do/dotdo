/**
 * LazyCheckpointer Concurrency Tests (RED Phase - TDD)
 *
 * Tests for race conditions in the LazyCheckpointer during checkpoint operations.
 *
 * BUG: There's a race condition where:
 * 1. checkpoint() reads dirty entries
 * 2. While SQLite write is in progress, new writes occur
 * 3. clearDirty() clears flags for ALL keys from step 1
 * 4. The new writes from step 2 have their dirty flags incorrectly cleared
 *
 * These tests should FAIL until the bug is fixed.
 *
 * @module objects/unified-storage/tests/lazy-checkpointer-concurrency.test
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  LazyCheckpointer,
  type DirtyTracker,
  type SqlStorage,
  type CheckpointStats,
} from '../../objects/unified-storage/lazy-checkpointer'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Mock DirtyTracker that allows controlled timing for testing race conditions
 */
class MockDirtyTracker implements DirtyTracker {
  private entries: Map<string, { type: string; data: unknown; size: number }> = new Map()
  private dirtySet: Set<string> = new Set()

  // Hook to intercept getDirtyEntries calls
  onGetDirtyEntries?: () => void

  // Hook to intercept clearDirty calls
  onClearDirty?: (keys: string[]) => void

  add(key: string, type: string, data: unknown): void {
    const size = JSON.stringify(data).length
    this.entries.set(key, { type, data, size })
    this.dirtySet.add(key)
  }

  getDirtyEntries(): Map<string, { type: string; data: unknown; size: number }> {
    this.onGetDirtyEntries?.()

    // Return only entries that are currently dirty
    const result = new Map<string, { type: string; data: unknown; size: number }>()
    for (const key of this.dirtySet) {
      const entry = this.entries.get(key)
      if (entry) {
        result.set(key, entry)
      }
    }
    return result
  }

  getDirtyCount(): number {
    return this.dirtySet.size
  }

  getMemoryUsage(): number {
    let total = 0
    for (const key of this.dirtySet) {
      const entry = this.entries.get(key)
      if (entry) {
        total += entry.size
      }
    }
    return total
  }

  clearDirty(keys: string[]): void {
    this.onClearDirty?.(keys)
    for (const key of keys) {
      this.dirtySet.delete(key)
    }
  }

  clear(): void {
    this.dirtySet.clear()
    this.entries.clear()
  }

  // Test helper: check if key is dirty
  isDirty(key: string): boolean {
    return this.dirtySet.has(key)
  }

  // Test helper: get the underlying dirty set for assertions
  getDirtySet(): Set<string> {
    return new Set(this.dirtySet)
  }
}

/**
 * Mock SQL storage with configurable delays for testing race conditions
 */
class MockSqlStorage implements SqlStorage {
  private tables: Map<string, Map<string, unknown>> = new Map()

  // Delay in ms to simulate slow SQL writes (for race condition testing)
  writeDelayMs = 0

  // Track writes for verification
  writes: Array<{ table: string; data: unknown }> = []

  // Promise that resolves when a write starts (for timing control)
  writeStarted?: () => void
  private writeStartedPromise?: Promise<void>

  constructor() {
    this.tables.set('columnar_store', new Map())
    this.tables.set('normalized_store', new Map())
  }

  createWriteStartedPromise(): Promise<void> {
    this.writeStartedPromise = new Promise((resolve) => {
      this.writeStarted = resolve
    })
    return this.writeStartedPromise
  }

  exec(query: string, ...params: unknown[]): { toArray(): unknown[] } {
    // Track the write
    this.writes.push({ table: query.includes('columnar') ? 'columnar' : 'normalized', data: params })

    // Signal that write has started
    this.writeStarted?.()

    // Simulate write delay (synchronous for simplicity in tests)
    if (this.writeDelayMs > 0) {
      const start = Date.now()
      while (Date.now() - start < this.writeDelayMs) {
        // Busy wait (in real code this would be async)
      }
    }

    // Parse and execute the query
    if (query.includes('columnar_store')) {
      const type = params[0] as string
      const data = params[1]
      this.tables.get('columnar_store')?.set(type, data)
    } else if (query.includes('normalized_store')) {
      const type = params[0] as string
      const id = params[1] as string
      const data = params[2]
      const normalized = this.tables.get('normalized_store')!
      const key = `${type}:${id}`
      normalized.set(key, data)
    }

    return { toArray: () => [] }
  }

  getWriteCount(): number {
    return this.writes.length
  }

  clearWrites(): void {
    this.writes = []
  }
}

// ============================================================================
// Test Suite: Checkpoint Concurrency Race Conditions
// ============================================================================

describe('LazyCheckpointer Concurrency', () => {
  let dirtyTracker: MockDirtyTracker
  let sql: MockSqlStorage
  let checkpointer: LazyCheckpointer

  beforeEach(() => {
    dirtyTracker = new MockDirtyTracker()
    sql = new MockSqlStorage()
    checkpointer = new LazyCheckpointer({
      sql,
      dirtyTracker,
      intervalMs: 10000, // Long interval - we'll trigger manually
      dirtyCountThreshold: 1000, // High threshold - manual triggers only
      memoryThresholdBytes: 100 * 1024 * 1024, // 100MB - high threshold
    })
  })

  afterEach(() => {
    checkpointer.stop()
  })

  // ==========================================================================
  // Race Condition: Write During Checkpoint
  // ==========================================================================

  describe('Write During Checkpoint Race Condition', () => {
    it('should NOT clear dirty flag for entries modified during checkpoint', async () => {
      /**
       * This test exposes the race condition:
       * 1. Add entry A (dirty)
       * 2. Start checkpoint - getDirtyEntries() captures A
       * 3. DURING checkpoint (after getDirtyEntries, before clearDirty):
       *    - Modify entry A (should remain dirty after checkpoint!)
       * 4. checkpoint completes, calls clearDirty([A])
       *
       * BUG: Entry A's dirty flag is cleared even though it was modified
       * DURING the checkpoint. This causes data loss as the modification
       * won't be persisted in the next checkpoint.
       */

      // Step 1: Add initial entry
      dirtyTracker.add('customer:1', 'Customer', { name: 'Alice', version: 1 })
      expect(dirtyTracker.isDirty('customer:1')).toBe(true)

      // Set up hook to modify entry DURING checkpoint (after getDirtyEntries)
      let modifiedDuringCheckpoint = false
      dirtyTracker.onGetDirtyEntries = () => {
        // This runs during checkpoint, after dirty entries are captured
        // Simulate a write that happens during the checkpoint
        dirtyTracker.add('customer:1', 'Customer', { name: 'Alice Updated', version: 2 })
        modifiedDuringCheckpoint = true
      }

      // Step 2: Run checkpoint
      await checkpointer.checkpoint('manual')

      // Verify the modification happened during checkpoint
      expect(modifiedDuringCheckpoint).toBe(true)

      // Step 3: The entry should STILL be dirty because it was modified DURING checkpoint
      // BUG: This fails because clearDirty clears the flag even though we wrote during checkpoint
      expect(dirtyTracker.isDirty('customer:1')).toBe(true)
    })

    it('should preserve dirty flags for NEW entries added during checkpoint', async () => {
      /**
       * Similar to above, but tests adding a completely new entry during checkpoint.
       * The new entry should remain dirty after checkpoint completes.
       */

      // Add initial entry
      dirtyTracker.add('customer:1', 'Customer', { name: 'Alice' })

      // Set up hook to add NEW entry during checkpoint
      dirtyTracker.onGetDirtyEntries = () => {
        // Add a completely new entry during checkpoint
        dirtyTracker.add('customer:2', 'Customer', { name: 'Bob' })
      }

      await checkpointer.checkpoint('manual')

      // customer:2 was added AFTER getDirtyEntries(), so it should still be dirty
      // Note: This might pass by accident if clearDirty only clears keys from the snapshot
      // But it's still a valid test case to ensure proper behavior
      expect(dirtyTracker.isDirty('customer:2')).toBe(true)
    })

    it('should use version tracking to detect concurrent modifications', async () => {
      /**
       * A proper fix would track version numbers or modification timestamps
       * to detect if an entry was modified during checkpoint.
       *
       * This test documents the expected behavior with a fix.
       */

      // Add entry with version 1
      dirtyTracker.add('order:1', 'Order', { status: 'pending', version: 1 })

      // Track what version was captured at checkpoint start
      let capturedVersion: number | undefined
      let hookCalled = false
      dirtyTracker.onGetDirtyEntries = () => {
        // Prevent recursive calls
        if (hookCalled) return
        hookCalled = true

        // Get current entry data before modification
        const entry = dirtyTracker['entries'].get('order:1')
        capturedVersion = (entry?.data as { version: number })?.version

        // Modify during checkpoint - new version
        dirtyTracker.add('order:1', 'Order', { status: 'shipped', version: 2 })
      }

      await checkpointer.checkpoint('manual')

      expect(capturedVersion).toBe(1)

      // Entry was modified to version 2 during checkpoint
      // It should still be dirty because the persisted version (1) != current version (2)
      expect(dirtyTracker.isDirty('order:1')).toBe(true)
    })
  })

  // ==========================================================================
  // Concurrent Checkpoint Calls
  // ==========================================================================

  describe('Concurrent Checkpoint Calls', () => {
    it('should have a checkpointInProgress guard', async () => {
      /**
       * BUG: There's no guard preventing concurrent checkpoint() calls.
       * If two checkpoints run simultaneously, they could interfere:
       * - Both read dirty entries
       * - Both write to SQLite (potential conflicts)
       * - Both call clearDirty (race condition)
       *
       * Expected: The checkpointer should have an isCheckpointInProgress() method
       * or similar mechanism to prevent concurrent checkpoints.
       */

      // This test checks if the guard exists
      // @ts-expect-error - checkpointInProgress might not exist yet (RED phase)
      const hasGuard = 'checkpointInProgress' in checkpointer || 'isCheckpointInProgress' in checkpointer

      // BUG: No guard exists currently
      expect(hasGuard).toBe(true)
    })

    it('should reject or queue concurrent checkpoint calls', async () => {
      /**
       * When checkpoint() is called while another is in progress,
       * it should either:
       * - Reject with an error
       * - Return the existing checkpoint promise
       * - Queue the request
       *
       * It should NOT allow two checkpoints to run simultaneously.
       */

      dirtyTracker.add('item:1', 'Item', { name: 'First' })
      dirtyTracker.add('item:2', 'Item', { name: 'Second' })

      // Start first checkpoint
      const checkpoint1 = checkpointer.checkpoint('manual')

      // Immediately start second checkpoint
      const checkpoint2 = checkpointer.checkpoint('manual')

      // One of these should be the expected behavior:
      // Option A: Second call rejects
      // Option B: Second call returns same promise as first
      // Option C: Second call waits for first to complete

      // For now, test that they don't corrupt data
      const [result1, result2] = await Promise.all([checkpoint1, checkpoint2])

      // At minimum, the total entities checkpointed should equal our entries
      // If both run simultaneously, we might see double-counting or missed entries
      const totalEntities = result1.entityCount + result2.entityCount

      // With proper serialization, one checkpoint handles all entries,
      // the second sees zero (or the same entries again if queued)
      // BUG: Without guards, behavior is undefined
      expect(totalEntities).toBeLessThanOrEqual(4) // At most 2 entities x 2 checkpoints
    })

    it('should serialize concurrent checkpoints to prevent data corruption', async () => {
      /**
       * Two concurrent checkpoints could cause:
       * 1. Both read the same dirty entries
       * 2. Both try to write to SQLite
       * 3. Both call clearDirty, potentially missing entries
       */

      // Add several entries
      for (let i = 0; i < 10; i++) {
        dirtyTracker.add(`record:${i}`, 'Record', { index: i })
      }

      // Track clearDirty calls
      const clearDirtyCalls: string[][] = []
      dirtyTracker.onClearDirty = (keys) => {
        clearDirtyCalls.push([...keys])
      }

      // Run concurrent checkpoints
      await Promise.all([
        checkpointer.checkpoint('manual'),
        checkpointer.checkpoint('manual'),
        checkpointer.checkpoint('manual'),
      ])

      // Verify no dirty entries remain
      expect(dirtyTracker.getDirtyCount()).toBe(0)

      // Count unique keys cleared (should be exactly 10)
      const allClearedKeys = new Set(clearDirtyCalls.flat())

      // BUG: With race conditions, some keys might be cleared multiple times
      // or some might be missed
      expect(allClearedKeys.size).toBe(10)
    })
  })

  // ==========================================================================
  // Checkpoint Guard Behavior
  // ==========================================================================

  describe('Checkpoint Guard Behavior (Expected but Missing)', () => {
    it('should expose isCheckpointInProgress() method', () => {
      /**
       * The checkpointer should have a method to query if a checkpoint is in progress.
       * This allows callers to:
       * - Wait for completion before making decisions
       * - Avoid starting operations that would conflict
       */

      // @ts-expect-error - Method might not exist yet (RED phase)
      expect(typeof checkpointer.isCheckpointInProgress).toBe('function')
    })

    it('should return true for isCheckpointInProgress during checkpoint', async () => {
      /**
       * When checkpoint() is running, isCheckpointInProgress() should return true.
       */

      dirtyTracker.add('test:1', 'Test', { data: 'value' })

      let wasInProgressDuringCheckpoint = false

      dirtyTracker.onGetDirtyEntries = () => {
        // Check during checkpoint execution
        // @ts-expect-error - Method might not exist yet (RED phase)
        wasInProgressDuringCheckpoint = checkpointer.isCheckpointInProgress?.() ?? false
      }

      await checkpointer.checkpoint('manual')

      // Should have been true during checkpoint
      expect(wasInProgressDuringCheckpoint).toBe(true)

      // Should be false after checkpoint completes
      // @ts-expect-error - Method might not exist yet (RED phase)
      expect(checkpointer.isCheckpointInProgress?.() ?? true).toBe(false)
    })

    it('should provide waitForCheckpoint() method', async () => {
      /**
       * Callers should be able to wait for an in-progress checkpoint to complete.
       * This is useful before hibernation or shutdown.
       */

      // @ts-expect-error - Method might not exist yet (RED phase)
      expect(typeof checkpointer.waitForCheckpoint).toBe('function')
    })
  })

  // ==========================================================================
  // Atomic Dirty Flag Management
  // ==========================================================================

  describe('Atomic Dirty Flag Management', () => {
    it('should only clear dirty flags for entries that match their checkpointed version', async () => {
      /**
       * The fix should track which version/timestamp was checkpointed.
       * clearDirty should only clear if the current version matches.
       *
       * Implementation could use:
       * - Version numbers per entry
       * - Modification timestamps
       * - Generation counters
       */

      dirtyTracker.add('entity:1', 'Entity', { value: 'original', version: 1 })

      // Modify during checkpoint
      dirtyTracker.onGetDirtyEntries = () => {
        dirtyTracker.add('entity:1', 'Entity', { value: 'modified', version: 2 })
      }

      await checkpointer.checkpoint('manual')

      // The checkpointed version was 1, but current version is 2
      // Entry should remain dirty
      expect(dirtyTracker.isDirty('entity:1')).toBe(true)
    })

    it('should handle rapid successive writes during checkpoint', async () => {
      /**
       * Multiple writes to the same entry during a single checkpoint
       * should all be tracked, and the entry should remain dirty.
       */

      dirtyTracker.add('counter:1', 'Counter', { count: 0 })

      let writeCount = 0
      dirtyTracker.onGetDirtyEntries = () => {
        // Simulate rapid writes during checkpoint
        for (let i = 1; i <= 5; i++) {
          dirtyTracker.add('counter:1', 'Counter', { count: i })
          writeCount++
        }
      }

      await checkpointer.checkpoint('manual')

      expect(writeCount).toBe(5)

      // Entry should still be dirty - we wrote 5 times during checkpoint
      expect(dirtyTracker.isDirty('counter:1')).toBe(true)
    })
  })

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle checkpoint during entry deletion', async () => {
      /**
       * If an entry is deleted during checkpoint:
       * - The delete should still be tracked
       * - clearDirty should not error on the missing entry
       */

      dirtyTracker.add('temp:1', 'Temp', { data: 'will be deleted' })
      dirtyTracker.add('temp:2', 'Temp', { data: 'will remain' })

      dirtyTracker.onGetDirtyEntries = () => {
        // Delete entry during checkpoint
        dirtyTracker.clearDirty(['temp:1'])
      }

      // Should not throw
      await expect(checkpointer.checkpoint('manual')).resolves.toBeDefined()
    })

    it('should handle empty checkpoint followed by writes', async () => {
      /**
       * Edge case: checkpoint starts with no dirty entries,
       * but entries are added after getDirtyEntries returns (during SQL write).
       *
       * This simulates writes arriving between:
       * 1. getDirtyEntries() returns empty
       * 2. checkpoint() returns (even though nothing to persist)
       *
       * The late-arriving write should remain dirty.
       */

      // No initial entries
      expect(dirtyTracker.getDirtyCount()).toBe(0)

      // Capture when checkpoint is complete to add entry "late"
      let checkpointStarted = false
      dirtyTracker.onGetDirtyEntries = () => {
        checkpointStarted = true
      }

      // Run checkpoint (will be empty)
      const checkpointPromise = checkpointer.checkpoint('manual')

      // Add entry after checkpoint started but might still be processing
      // In the real bug, this would be added during SQL write phase
      dirtyTracker.add('late:1', 'Late', { added: 'during checkpoint' })

      const stats = await checkpointPromise

      expect(checkpointStarted).toBe(true)

      // Original checkpoint saw 0 entries
      expect(stats.entityCount).toBe(0)

      // The entry added after checkpoint started should still be dirty
      // (this should pass since it wasn't in the original getDirtyEntries snapshot)
      expect(dirtyTracker.isDirty('late:1')).toBe(true)
    })

    it('should handle checkpoint during threshold-triggered checkpoint', async () => {
      /**
       * If threshold triggers a checkpoint while manual checkpoint is running,
       * they should be serialized properly.
       */

      const thresholdCheckpointer = new LazyCheckpointer({
        sql,
        dirtyTracker,
        intervalMs: 10000,
        dirtyCountThreshold: 5, // Low threshold
        memoryThresholdBytes: 100 * 1024 * 1024,
      })

      // Add entries to approach threshold
      for (let i = 0; i < 4; i++) {
        dirtyTracker.add(`item:${i}`, 'Item', { index: i })
      }

      // Start manual checkpoint
      const manualCheckpoint = thresholdCheckpointer.checkpoint('manual')

      // During checkpoint, add entry that exceeds threshold
      dirtyTracker.onGetDirtyEntries = () => {
        dirtyTracker.add('item:4', 'Item', { index: 4 })
        // This would trigger notifyDirty() which might start another checkpoint
        thresholdCheckpointer.notifyDirty()
      }

      await manualCheckpoint

      // All entries should eventually be clean or properly tracked
      // BUG: Without guards, behavior is undefined
      thresholdCheckpointer.stop()
    })
  })

  // ==========================================================================
  // Stress Tests
  // ==========================================================================

  describe('Stress Tests', () => {
    it('should handle many concurrent operations without data loss', async () => {
      /**
       * Stress test: Many writes and checkpoints happening simultaneously.
       * All data should eventually be persisted.
       */

      const writeCount = 100
      const checkpointCount = 10

      // Start checkpoints in parallel with writes
      const operations: Promise<unknown>[] = []

      for (let i = 0; i < writeCount; i++) {
        dirtyTracker.add(`stress:${i}`, 'Stress', { index: i })

        // Interleave checkpoints
        if (i % (writeCount / checkpointCount) === 0) {
          operations.push(checkpointer.checkpoint('manual'))
        }
      }

      // Wait for all checkpoints
      await Promise.all(operations)

      // Final checkpoint to clean up
      await checkpointer.checkpoint('manual')

      // All entries should be clean
      expect(dirtyTracker.getDirtyCount()).toBe(0)

      // Verify all entries were written
      expect(sql.getWriteCount()).toBeGreaterThan(0)
    })
  })
})
