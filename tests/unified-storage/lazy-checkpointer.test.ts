/**
 * LazyCheckpointer RED Tests
 *
 * Failing tests that define the API for LazyCheckpointer.
 * These tests should FAIL until LazyCheckpointer is implemented.
 *
 * LazyCheckpointer persists dirty state to SQLite on various triggers:
 * - Timer-based (every N seconds)
 * - Threshold-based (when dirty count or memory exceeds limit)
 * - Hibernation (before DO hibernates)
 * - Manual (explicit checkpoint call)
 *
 * Uses ColumnarStore for 99% cost reduction (one row per collection type).
 *
 * @see objects/unified-storage/lazy-checkpointer.ts (to be implemented)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// This import will FAIL - the module doesn't exist yet
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error - LazyCheckpointer not implemented yet (TDD RED phase)
import { LazyCheckpointer } from '../../objects/unified-storage/lazy-checkpointer'

// ============================================================================
// Mock SQLite Storage
// ============================================================================

/**
 * Mock SqlStorage for testing
 */
function createMockSqlStorage() {
  const tables = new Map<string, Map<string, unknown>>()
  let writeCount = 0

  return {
    exec: vi.fn((query: string, ...params: unknown[]) => {
      const queryLower = query.toLowerCase().trim()

      // Track writes for cost analysis
      if (queryLower.startsWith('insert') || queryLower.startsWith('update')) {
        writeCount++
      }

      // Handle CREATE TABLE
      if (queryLower.startsWith('create table')) {
        const tableMatch = query.match(/create table if not exists (\w+)/i)
        if (tableMatch) {
          if (!tables.has(tableMatch[1])) {
            tables.set(tableMatch[1], new Map())
          }
        }
        return { toArray: () => [] }
      }

      // Handle SELECT
      if (queryLower.startsWith('select')) {
        const tableMatch = query.match(/from (\w+)/i)
        if (tableMatch) {
          const table = tables.get(tableMatch[1])
          if (table && params.length > 0) {
            const id = params[0] as string
            const row = table.get(id)
            return { toArray: () => row ? [row] : [] }
          }
        }
        return { toArray: () => [] }
      }

      // Handle INSERT/UPSERT
      if (queryLower.startsWith('insert')) {
        const tableMatch = query.match(/insert into (\w+)/i)
        if (tableMatch) {
          let table = tables.get(tableMatch[1])
          if (!table) {
            table = new Map()
            tables.set(tableMatch[1], table)
          }
          // Store the first param as key
          if (params.length > 0) {
            table.set(params[0] as string, { params })
          }
        }
        return { toArray: () => [] }
      }

      return { toArray: () => [] }
    }),
    _tables: tables,
    _getWriteCount: () => writeCount,
    _resetWriteCount: () => { writeCount = 0 },
  }
}

/**
 * Mock dirty tracker that simulates entity changes
 */
function createMockDirtyTracker() {
  const dirtyEntries = new Map<string, { type: string; data: unknown; size: number }>()

  return {
    markDirty: vi.fn((type: string, id: string, data: unknown) => {
      const size = JSON.stringify(data).length
      dirtyEntries.set(`${type}:${id}`, { type, data, size })
    }),
    getDirtyEntries: vi.fn(() => new Map(dirtyEntries)),
    getDirtyCount: vi.fn(() => dirtyEntries.size),
    getMemoryUsage: vi.fn(() => {
      let total = 0
      for (const entry of dirtyEntries.values()) {
        total += entry.size
      }
      return total
    }),
    clearDirty: vi.fn((keys: string[]) => {
      for (const key of keys) {
        dirtyEntries.delete(key)
      }
    }),
    clear: vi.fn(() => dirtyEntries.clear()),
    _entries: dirtyEntries,
  }
}

// ============================================================================
// Timer Trigger Tests
// ============================================================================

describe('LazyCheckpointer', () => {
  describe('timer triggers', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should checkpoint after configured interval', async () => {
      const sql = createMockSqlStorage()
      const dirtyTracker = createMockDirtyTracker()

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker,
        intervalMs: 5000, // 5 seconds
      })

      // Add some dirty entries
      dirtyTracker.markDirty('User', 'user-1', { name: 'Alice' })
      dirtyTracker.markDirty('User', 'user-2', { name: 'Bob' })

      checkpointer.start()

      // Fast-forward past the interval
      vi.advanceTimersByTime(5001)

      // Should have checkpointed
      expect(sql.exec).toHaveBeenCalled()
      expect(dirtyTracker.clearDirty).toHaveBeenCalled()

      checkpointer.stop()
    })

    it('should reset timer after checkpoint', async () => {
      const sql = createMockSqlStorage()
      const dirtyTracker = createMockDirtyTracker()

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker,
        intervalMs: 5000,
      })

      dirtyTracker.markDirty('User', 'user-1', { name: 'Alice' })

      checkpointer.start()

      // First checkpoint
      vi.advanceTimersByTime(5001)
      const callCount1 = sql.exec.mock.calls.length

      // Add more dirty data
      dirtyTracker.markDirty('User', 'user-3', { name: 'Charlie' })

      // Wait partial interval - should NOT checkpoint
      vi.advanceTimersByTime(3000)
      expect(sql.exec.mock.calls.length).toBe(callCount1)

      // Complete the interval - should checkpoint
      vi.advanceTimersByTime(2001)
      expect(sql.exec.mock.calls.length).toBeGreaterThan(callCount1)

      checkpointer.stop()
    })

    it('should not checkpoint if no dirty entries', async () => {
      const sql = createMockSqlStorage()
      const dirtyTracker = createMockDirtyTracker()

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker,
        intervalMs: 5000,
      })

      checkpointer.start()

      // No dirty entries added
      const writesBefore = sql._getWriteCount()

      vi.advanceTimersByTime(5001)

      // Should not have written anything
      expect(sql._getWriteCount()).toBe(writesBefore)

      checkpointer.stop()
    })

    it('should stop timer on stop()', async () => {
      const sql = createMockSqlStorage()
      const dirtyTracker = createMockDirtyTracker()

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker,
        intervalMs: 5000,
      })

      dirtyTracker.markDirty('User', 'user-1', { name: 'Alice' })

      checkpointer.start()
      checkpointer.stop()

      const callCount = sql.exec.mock.calls.length

      // Advance past multiple intervals
      vi.advanceTimersByTime(20000)

      // Should not have checkpointed after stop
      expect(sql.exec.mock.calls.length).toBe(callCount)
    })
  })

  // ============================================================================
  // Threshold Trigger Tests
  // ============================================================================

  describe('threshold triggers', () => {
    it('should checkpoint when dirty count exceeds threshold', async () => {
      const sql = createMockSqlStorage()
      const dirtyTracker = createMockDirtyTracker()

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker,
        dirtyCountThreshold: 5,
        intervalMs: 60000, // Long interval to ensure count trigger fires first
      })

      checkpointer.start()

      // Add entries up to threshold
      for (let i = 0; i < 4; i++) {
        dirtyTracker.markDirty('User', `user-${i}`, { name: `User ${i}` })
        checkpointer.notifyDirty()
      }

      // Not yet at threshold
      expect(dirtyTracker.clearDirty).not.toHaveBeenCalled()

      // Add one more to exceed threshold
      dirtyTracker.markDirty('User', 'user-4', { name: 'User 4' })
      checkpointer.notifyDirty()

      // Should have triggered checkpoint
      expect(sql.exec).toHaveBeenCalled()
      expect(dirtyTracker.clearDirty).toHaveBeenCalled()

      checkpointer.stop()
    })

    it('should checkpoint when memory usage exceeds threshold', async () => {
      const sql = createMockSqlStorage()
      const dirtyTracker = createMockDirtyTracker()

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker,
        memoryThresholdBytes: 1000, // 1KB threshold
        intervalMs: 60000,
      })

      checkpointer.start()

      // Add a small entry
      dirtyTracker.markDirty('User', 'user-1', { name: 'Alice' })
      checkpointer.notifyDirty()

      expect(dirtyTracker.clearDirty).not.toHaveBeenCalled()

      // Add a large entry that exceeds threshold
      dirtyTracker.markDirty('Document', 'doc-1', {
        content: 'x'.repeat(2000), // 2KB of data
      })
      checkpointer.notifyDirty()

      // Should have triggered checkpoint
      expect(sql.exec).toHaveBeenCalled()
      expect(dirtyTracker.clearDirty).toHaveBeenCalled()

      checkpointer.stop()
    })

    it('should checkpoint immediately on threshold breach', async () => {
      const sql = createMockSqlStorage()
      const dirtyTracker = createMockDirtyTracker()

      const checkpointCalls: number[] = []
      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker,
        dirtyCountThreshold: 3,
        intervalMs: 60000,
        onCheckpoint: () => {
          checkpointCalls.push(Date.now())
        },
      })

      checkpointer.start()

      const startTime = Date.now()

      // Add entries to exceed threshold
      for (let i = 0; i < 4; i++) {
        dirtyTracker.markDirty('User', `user-${i}`, { name: `User ${i}` })
        checkpointer.notifyDirty()
      }

      // Checkpoint should have happened immediately (synchronously)
      expect(checkpointCalls.length).toBeGreaterThan(0)
      expect(checkpointCalls[0] - startTime).toBeLessThan(100) // Within 100ms

      checkpointer.stop()
    })
  })

  // ============================================================================
  // Hibernation Trigger Tests
  // ============================================================================

  describe('hibernation trigger', () => {
    it('should checkpoint on beforeHibernation()', async () => {
      const sql = createMockSqlStorage()
      const dirtyTracker = createMockDirtyTracker()

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker,
        intervalMs: 60000,
      })

      // Add dirty entries
      dirtyTracker.markDirty('User', 'user-1', { name: 'Alice' })
      dirtyTracker.markDirty('Session', 'session-1', { active: true })

      // Call hibernation hook
      await checkpointer.beforeHibernation()

      // Should have flushed everything
      expect(sql.exec).toHaveBeenCalled()
      expect(dirtyTracker.clearDirty).toHaveBeenCalled()
    })

    it('should flush all dirty entries before hibernation', async () => {
      const sql = createMockSqlStorage()
      const dirtyTracker = createMockDirtyTracker()

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker,
        intervalMs: 60000,
      })

      // Add many dirty entries
      for (let i = 0; i < 100; i++) {
        dirtyTracker.markDirty('User', `user-${i}`, { name: `User ${i}` })
      }

      await checkpointer.beforeHibernation()

      // All entries should have been cleared
      expect(dirtyTracker.getDirtyCount()).toBe(0)
    })

    it('should complete checkpoint before returning', async () => {
      const sql = createMockSqlStorage()
      const dirtyTracker = createMockDirtyTracker()

      let checkpointCompleted = false

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker,
        intervalMs: 60000,
        onCheckpoint: async () => {
          // Simulate async checkpoint work
          await new Promise(resolve => setTimeout(resolve, 10))
          checkpointCompleted = true
        },
      })

      dirtyTracker.markDirty('User', 'user-1', { name: 'Alice' })

      // beforeHibernation should wait for checkpoint to complete
      await checkpointer.beforeHibernation()

      expect(checkpointCompleted).toBe(true)
    })
  })

  // ============================================================================
  // Columnar Storage Tests
  // ============================================================================

  describe('columnar storage', () => {
    it('should write small collections as single row (columnar)', async () => {
      const sql = createMockSqlStorage()
      const dirtyTracker = createMockDirtyTracker()

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker,
        columnarThreshold: 100, // Use columnar for collections < 100 items
        intervalMs: 60000,
      })

      // Add a small collection of users
      for (let i = 0; i < 10; i++) {
        dirtyTracker.markDirty('User', `user-${i}`, { name: `User ${i}` })
      }

      sql._resetWriteCount()
      await checkpointer.checkpoint()

      // Should have written as single columnar row
      // One row for the 'User' collection type
      expect(sql._getWriteCount()).toBe(1)
    })

    it('should write large collections as individual rows (normalized)', async () => {
      const sql = createMockSqlStorage()
      const dirtyTracker = createMockDirtyTracker()

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker,
        columnarThreshold: 10, // Use normalized for collections >= 10 items
        intervalMs: 60000,
      })

      // Add a large collection
      for (let i = 0; i < 50; i++) {
        dirtyTracker.markDirty('User', `user-${i}`, { name: `User ${i}` })
      }

      sql._resetWriteCount()
      await checkpointer.checkpoint()

      // Should have written as individual rows (normalized)
      expect(sql._getWriteCount()).toBe(50)
    })

    it('should use configurable threshold for columnar vs normalized', async () => {
      const sql = createMockSqlStorage()
      const dirtyTracker = createMockDirtyTracker()

      // Test with low threshold
      const checkpointer1 = new LazyCheckpointer({
        sql,
        dirtyTracker,
        columnarThreshold: 5,
        intervalMs: 60000,
      })

      for (let i = 0; i < 5; i++) {
        dirtyTracker.markDirty('User', `user-${i}`, { name: `User ${i}` })
      }

      sql._resetWriteCount()
      await checkpointer1.checkpoint()

      // At threshold, should use normalized (1 row per entity)
      expect(sql._getWriteCount()).toBe(5)

      // Reset and test with high threshold
      dirtyTracker.clear()
      const checkpointer2 = new LazyCheckpointer({
        sql,
        dirtyTracker,
        columnarThreshold: 100,
        intervalMs: 60000,
      })

      for (let i = 0; i < 5; i++) {
        dirtyTracker.markDirty('User', `user-${i}`, { name: `User ${i}` })
      }

      sql._resetWriteCount()
      await checkpointer2.checkpoint()

      // Below threshold, should use columnar (1 row for collection)
      expect(sql._getWriteCount()).toBe(1)
    })

    it('should track row write count for cost analysis', async () => {
      const sql = createMockSqlStorage()
      const dirtyTracker = createMockDirtyTracker()

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker,
        columnarThreshold: 100,
        intervalMs: 60000,
      })

      // Add multiple collection types
      for (let i = 0; i < 10; i++) {
        dirtyTracker.markDirty('User', `user-${i}`, { name: `User ${i}` })
      }
      for (let i = 0; i < 5; i++) {
        dirtyTracker.markDirty('Session', `session-${i}`, { active: true })
      }

      await checkpointer.checkpoint()

      const stats = checkpointer.getStats()

      // Should report row writes
      expect(stats.totalRowWrites).toBeDefined()
      expect(stats.totalRowWrites).toBeGreaterThan(0)

      // Should track columnar vs normalized
      expect(stats.columnarWrites).toBeDefined()
      expect(stats.normalizedWrites).toBeDefined()
    })
  })

  // ============================================================================
  // Checkpoint Stats Tests
  // ============================================================================

  describe('checkpoint stats', () => {
    it('should return checkpoint stats after checkpoint', async () => {
      const sql = createMockSqlStorage()
      const dirtyTracker = createMockDirtyTracker()

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker,
        intervalMs: 60000,
      })

      dirtyTracker.markDirty('User', 'user-1', { name: 'Alice' })
      dirtyTracker.markDirty('User', 'user-2', { name: 'Bob' })

      const stats = await checkpointer.checkpoint()

      expect(stats).toBeDefined()
      expect(stats.entityCount).toBe(2)
    })

    it('should track entity count in stats', async () => {
      const sql = createMockSqlStorage()
      const dirtyTracker = createMockDirtyTracker()

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker,
        intervalMs: 60000,
      })

      for (let i = 0; i < 25; i++) {
        dirtyTracker.markDirty('User', `user-${i}`, { name: `User ${i}` })
      }

      const stats = await checkpointer.checkpoint()

      expect(stats.entityCount).toBe(25)
    })

    it('should track bytes written in stats', async () => {
      const sql = createMockSqlStorage()
      const dirtyTracker = createMockDirtyTracker()

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker,
        intervalMs: 60000,
      })

      dirtyTracker.markDirty('Document', 'doc-1', {
        content: 'Hello, World!'.repeat(100),
      })

      const stats = await checkpointer.checkpoint()

      expect(stats.bytesWritten).toBeDefined()
      expect(stats.bytesWritten).toBeGreaterThan(0)
    })

    it('should track duration in stats', async () => {
      const sql = createMockSqlStorage()
      const dirtyTracker = createMockDirtyTracker()

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker,
        intervalMs: 60000,
      })

      for (let i = 0; i < 100; i++) {
        dirtyTracker.markDirty('User', `user-${i}`, { name: `User ${i}` })
      }

      const stats = await checkpointer.checkpoint()

      expect(stats.durationMs).toBeDefined()
      expect(stats.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('should track trigger type in stats', async () => {
      const sql = createMockSqlStorage()
      const dirtyTracker = createMockDirtyTracker()

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker,
        intervalMs: 60000,
      })

      dirtyTracker.markDirty('User', 'user-1', { name: 'Alice' })

      // Manual trigger
      const manualStats = await checkpointer.checkpoint('manual')
      expect(manualStats.trigger).toBe('manual')

      // Add more data
      dirtyTracker.markDirty('User', 'user-2', { name: 'Bob' })

      // Hibernation trigger
      const hibernationStats = await checkpointer.checkpoint('hibernation')
      expect(hibernationStats.trigger).toBe('hibernation')
    })
  })

  // ============================================================================
  // Dirty Tracking Integration Tests
  // ============================================================================

  describe('dirty tracking integration', () => {
    it('should clear dirty flags after successful checkpoint', async () => {
      const sql = createMockSqlStorage()
      const dirtyTracker = createMockDirtyTracker()

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker,
        intervalMs: 60000,
      })

      dirtyTracker.markDirty('User', 'user-1', { name: 'Alice' })
      dirtyTracker.markDirty('User', 'user-2', { name: 'Bob' })

      expect(dirtyTracker.getDirtyCount()).toBe(2)

      await checkpointer.checkpoint()

      expect(dirtyTracker.getDirtyCount()).toBe(0)
    })

    it('should preserve dirty flags on checkpoint failure', async () => {
      const sql = createMockSqlStorage()
      const dirtyTracker = createMockDirtyTracker()

      // Make SQL fail
      sql.exec.mockImplementation(() => {
        throw new Error('Database unavailable')
      })

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker,
        intervalMs: 60000,
      })

      dirtyTracker.markDirty('User', 'user-1', { name: 'Alice' })
      dirtyTracker.markDirty('User', 'user-2', { name: 'Bob' })

      const initialCount = dirtyTracker.getDirtyCount()

      // Checkpoint should fail
      await expect(checkpointer.checkpoint()).rejects.toThrow()

      // Dirty flags should be preserved for retry
      expect(dirtyTracker.getDirtyCount()).toBe(initialCount)
      expect(dirtyTracker.clearDirty).not.toHaveBeenCalled()
    })

    it('should only checkpoint dirty entries', async () => {
      const sql = createMockSqlStorage()
      const dirtyTracker = createMockDirtyTracker()

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker,
        intervalMs: 60000,
      })

      // Add and checkpoint some entries
      dirtyTracker.markDirty('User', 'user-1', { name: 'Alice' })
      await checkpointer.checkpoint()

      // Add more entries
      dirtyTracker.markDirty('User', 'user-2', { name: 'Bob' })
      dirtyTracker.markDirty('User', 'user-3', { name: 'Charlie' })

      // Get the entries that will be checkpointed
      const checkpointedStats = await checkpointer.checkpoint()

      // Should only include the newly dirtied entries (user-2 and user-3)
      // user-1 was already cleaned in the first checkpoint
      expect(checkpointedStats.entityCount).toBe(2)
    })
  })

  // ============================================================================
  // Configuration Tests
  // ============================================================================

  describe('configuration', () => {
    it('should accept custom interval configuration', () => {
      const sql = createMockSqlStorage()
      const dirtyTracker = createMockDirtyTracker()

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker,
        intervalMs: 30000, // 30 seconds
      })

      expect(checkpointer.getConfig().intervalMs).toBe(30000)
    })

    it('should accept custom threshold configuration', () => {
      const sql = createMockSqlStorage()
      const dirtyTracker = createMockDirtyTracker()

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker,
        dirtyCountThreshold: 50,
        memoryThresholdBytes: 1024 * 1024, // 1MB
      })

      const config = checkpointer.getConfig()
      expect(config.dirtyCountThreshold).toBe(50)
      expect(config.memoryThresholdBytes).toBe(1024 * 1024)
    })

    it('should accept onCheckpoint callback', async () => {
      const sql = createMockSqlStorage()
      const dirtyTracker = createMockDirtyTracker()

      const checkpointEvents: unknown[] = []

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker,
        intervalMs: 60000,
        onCheckpoint: (stats) => {
          checkpointEvents.push(stats)
        },
      })

      dirtyTracker.markDirty('User', 'user-1', { name: 'Alice' })
      await checkpointer.checkpoint()

      expect(checkpointEvents.length).toBe(1)
    })

    it('should have sensible defaults', () => {
      const sql = createMockSqlStorage()
      const dirtyTracker = createMockDirtyTracker()

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker,
      })

      const config = checkpointer.getConfig()

      // Verify sensible defaults exist
      expect(config.intervalMs).toBeGreaterThan(0)
      expect(config.dirtyCountThreshold).toBeGreaterThan(0)
      expect(config.memoryThresholdBytes).toBeGreaterThan(0)
      expect(config.columnarThreshold).toBeGreaterThan(0)
    })
  })

  // ============================================================================
  // Error Handling Tests
  // ============================================================================

  describe('error handling', () => {
    it('should emit error event on checkpoint failure', async () => {
      const sql = createMockSqlStorage()
      const dirtyTracker = createMockDirtyTracker()

      sql.exec.mockImplementation(() => {
        throw new Error('Database error')
      })

      const errors: Error[] = []

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker,
        intervalMs: 60000,
        onError: (error) => {
          errors.push(error)
        },
      })

      dirtyTracker.markDirty('User', 'user-1', { name: 'Alice' })

      await expect(checkpointer.checkpoint()).rejects.toThrow('Database error')

      expect(errors.length).toBe(1)
      expect(errors[0].message).toBe('Database error')
    })

    it('should continue operating after checkpoint failure', async () => {
      vi.useFakeTimers()

      const sql = createMockSqlStorage()
      const dirtyTracker = createMockDirtyTracker()

      let failCount = 0
      sql.exec.mockImplementation(() => {
        failCount++
        if (failCount <= 1) {
          throw new Error('Temporary error')
        }
        return { toArray: () => [] }
      })

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker,
        intervalMs: 5000,
        onError: () => {}, // Suppress error
      })

      dirtyTracker.markDirty('User', 'user-1', { name: 'Alice' })
      checkpointer.start()

      // First checkpoint fails
      vi.advanceTimersByTime(5001)

      // Add new data
      dirtyTracker.markDirty('User', 'user-2', { name: 'Bob' })

      // Second checkpoint should succeed
      vi.advanceTimersByTime(5001)

      expect(failCount).toBe(2) // Two attempts
      expect(dirtyTracker.clearDirty).toHaveBeenCalled()

      checkpointer.stop()
      vi.useRealTimers()
    })
  })

  // ============================================================================
  // Lifecycle Tests
  // ============================================================================

  describe('lifecycle', () => {
    it('should be stoppable and restartable', () => {
      vi.useFakeTimers()

      const sql = createMockSqlStorage()
      const dirtyTracker = createMockDirtyTracker()

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker,
        intervalMs: 5000,
      })

      dirtyTracker.markDirty('User', 'user-1', { name: 'Alice' })

      checkpointer.start()
      expect(checkpointer.isRunning()).toBe(true)

      checkpointer.stop()
      expect(checkpointer.isRunning()).toBe(false)

      checkpointer.start()
      expect(checkpointer.isRunning()).toBe(true)

      checkpointer.stop()
      vi.useRealTimers()
    })

    it('should flush on destroy', async () => {
      const sql = createMockSqlStorage()
      const dirtyTracker = createMockDirtyTracker()

      const checkpointer = new LazyCheckpointer({
        sql,
        dirtyTracker,
        intervalMs: 60000,
      })

      dirtyTracker.markDirty('User', 'user-1', { name: 'Alice' })

      await checkpointer.destroy()

      // Should have flushed before destroying
      expect(sql.exec).toHaveBeenCalled()
      expect(checkpointer.isRunning()).toBe(false)
    })
  })
})
