/**
 * TemporalStore tests
 *
 * RED phase: These tests define the expected behavior of TemporalStore.
 * All tests should FAIL until implementation is complete.
 *
 * TemporalStore provides time-travel queries over a key-value store:
 * - put/get operations with timestamps
 * - getAsOf for historical queries
 * - range queries with time bounds
 * - snapshot creation and restoration
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  TemporalStore,
  createTemporalStore,
  type TimeRange,
  type SnapshotId,
  type SnapshotInfo,
} from '../temporal-store'

// ============================================================================
// TEST DATA AND HELPERS
// ============================================================================

interface TestValue {
  name: string
  count: number
  tags?: string[]
}

function createTestStore(): TemporalStore<TestValue> {
  return createTemporalStore<TestValue>()
}

/**
 * Helper to collect all items from an async iterator
 */
async function collectIterator<T>(iterator: AsyncIterator<T>): Promise<T[]> {
  const results: T[] = []
  let result = await iterator.next()
  while (!result.done) {
    results.push(result.value)
    result = await iterator.next()
  }
  return results
}

/**
 * Typed helper for TestValue iteration
 */
async function collectTestValues(iterator: AsyncIterator<TestValue>): Promise<TestValue[]> {
  return collectIterator<TestValue>(iterator)
}

/**
 * Generate timestamp for testing (ms since epoch)
 */
function ts(offsetMs: number = 0): number {
  return Date.now() + offsetMs
}

// ============================================================================
// BASIC PUT/GET OPERATIONS
// ============================================================================

describe('TemporalStore', () => {
  describe('basic put/get operations', () => {
    it('should store and retrieve a value', async () => {
      const store = createTestStore()
      const timestamp = ts()

      await store.put('user:1', { name: 'Alice', count: 1 }, timestamp)
      const result = await store.get('user:1')

      expect(result).not.toBeNull()
      expect(result?.name).toBe('Alice')
      expect(result?.count).toBe(1)
    })

    it('should return null for non-existent key', async () => {
      const store = createTestStore()

      const result = await store.get('nonexistent')

      expect(result).toBeNull()
    })

    it('should return the latest value for a key', async () => {
      const store = createTestStore()
      const t1 = ts(-1000)
      const t2 = ts()

      await store.put('user:1', { name: 'Alice', count: 1 }, t1)
      await store.put('user:1', { name: 'Alice Updated', count: 2 }, t2)

      const result = await store.get('user:1')

      expect(result?.name).toBe('Alice Updated')
      expect(result?.count).toBe(2)
    })

    it('should handle complex nested objects', async () => {
      const store = createTestStore()
      const timestamp = ts()

      await store.put('user:1', { name: 'Alice', count: 5, tags: ['admin', 'active'] }, timestamp)
      const result = await store.get('user:1')

      expect(result?.tags).toEqual(['admin', 'active'])
    })

    it('should handle multiple independent keys', async () => {
      const store = createTestStore()
      const timestamp = ts()

      await store.put('user:1', { name: 'Alice', count: 1 }, timestamp)
      await store.put('user:2', { name: 'Bob', count: 2 }, timestamp)
      await store.put('user:3', { name: 'Charlie', count: 3 }, timestamp)

      const alice = await store.get('user:1')
      const bob = await store.get('user:2')
      const charlie = await store.get('user:3')

      expect(alice?.name).toBe('Alice')
      expect(bob?.name).toBe('Bob')
      expect(charlie?.name).toBe('Charlie')
    })

    it('should handle empty string key', async () => {
      const store = createTestStore()
      const timestamp = ts()

      await store.put('', { name: 'Empty Key', count: 0 }, timestamp)
      const result = await store.get('')

      expect(result?.name).toBe('Empty Key')
    })

    it('should handle keys with special characters', async () => {
      const store = createTestStore()
      const timestamp = ts()

      await store.put('user:alice@example.com', { name: 'Alice', count: 1 }, timestamp)
      await store.put('path/to/resource', { name: 'Resource', count: 2 }, timestamp)
      await store.put('key:with:colons', { name: 'Colons', count: 3 }, timestamp)

      expect((await store.get('user:alice@example.com'))?.name).toBe('Alice')
      expect((await store.get('path/to/resource'))?.name).toBe('Resource')
      expect((await store.get('key:with:colons'))?.name).toBe('Colons')
    })
  })

  // ============================================================================
  // TIME-TRAVEL QUERIES (getAsOf)
  // ============================================================================

  describe('time-travel queries (getAsOf)', () => {
    it('should retrieve value as it existed at a specific timestamp', async () => {
      const store = createTestStore()
      const t1 = ts(-2000)
      const t2 = ts(-1000)
      const t3 = ts()

      await store.put('user:1', { name: 'V1', count: 1 }, t1)
      await store.put('user:1', { name: 'V2', count: 2 }, t2)
      await store.put('user:1', { name: 'V3', count: 3 }, t3)

      const resultAtT1 = await store.getAsOf('user:1', t1)
      const resultAtT2 = await store.getAsOf('user:1', t2)
      const resultAtT3 = await store.getAsOf('user:1', t3)

      expect(resultAtT1?.name).toBe('V1')
      expect(resultAtT2?.name).toBe('V2')
      expect(resultAtT3?.name).toBe('V3')
    })

    it('should return the most recent value before the given timestamp', async () => {
      const store = createTestStore()
      const t1 = ts(-3000)
      const t2 = ts(-1000)
      const queryTime = ts(-2000) // Between t1 and t2

      await store.put('user:1', { name: 'Before', count: 1 }, t1)
      await store.put('user:1', { name: 'After', count: 2 }, t2)

      const result = await store.getAsOf('user:1', queryTime)

      expect(result?.name).toBe('Before')
    })

    it('should return null for timestamp before key existed', async () => {
      const store = createTestStore()
      const createTime = ts()
      const queryTime = ts(-1000) // Before creation

      await store.put('user:1', { name: 'Alice', count: 1 }, createTime)

      const result = await store.getAsOf('user:1', queryTime)

      expect(result).toBeNull()
    })

    it('should return null for non-existent key regardless of timestamp', async () => {
      const store = createTestStore()

      const result = await store.getAsOf('nonexistent', ts())

      expect(result).toBeNull()
    })

    it('should handle exact timestamp matches', async () => {
      const store = createTestStore()
      const exactTime = 1000000000000 // Fixed timestamp

      await store.put('user:1', { name: 'Exact', count: 1 }, exactTime)

      const result = await store.getAsOf('user:1', exactTime)

      expect(result?.name).toBe('Exact')
    })

    it('should support querying multiple keys at the same historical point', async () => {
      const store = createTestStore()
      const t1 = ts(-2000)
      const t2 = ts()

      await store.put('user:1', { name: 'Alice V1', count: 1 }, t1)
      await store.put('user:2', { name: 'Bob V1', count: 1 }, t1)
      await store.put('user:1', { name: 'Alice V2', count: 2 }, t2)
      await store.put('user:2', { name: 'Bob V2', count: 2 }, t2)

      const alice = await store.getAsOf('user:1', t1)
      const bob = await store.getAsOf('user:2', t1)

      expect(alice?.name).toBe('Alice V1')
      expect(bob?.name).toBe('Bob V1')
    })

    it('should handle rapid succession of updates', async () => {
      const store = createTestStore()
      const baseTime = ts(-100)

      // Simulate rapid updates with 1ms increments
      for (let i = 0; i < 10; i++) {
        await store.put('counter', { name: 'counter', count: i }, baseTime + i)
      }

      // Query at specific points
      expect((await store.getAsOf('counter', baseTime + 0))?.count).toBe(0)
      expect((await store.getAsOf('counter', baseTime + 5))?.count).toBe(5)
      expect((await store.getAsOf('counter', baseTime + 9))?.count).toBe(9)
    })

    it('should preserve full object state at each point in time', async () => {
      const store = createTestStore()
      const t1 = ts(-2000)
      const t2 = ts()

      await store.put('user:1', { name: 'Alice', count: 1, tags: ['new'] }, t1)
      await store.put('user:1', { name: 'Alice', count: 5, tags: ['active', 'premium'] }, t2)

      const pastState = await store.getAsOf('user:1', t1)

      expect(pastState?.count).toBe(1)
      expect(pastState?.tags).toEqual(['new'])
    })
  })

  // ============================================================================
  // RANGE QUERIES WITH TIME BOUNDS
  // ============================================================================

  describe('range queries with time bounds', () => {
    it('should return all values with matching prefix', async () => {
      const store = createTestStore()
      const timestamp = ts()

      await store.put('user:1', { name: 'Alice', count: 1 }, timestamp)
      await store.put('user:2', { name: 'Bob', count: 2 }, timestamp)
      await store.put('user:3', { name: 'Charlie', count: 3 }, timestamp)
      await store.put('product:1', { name: 'Widget', count: 100 }, timestamp)

      const results = await collectTestValues(store.range('user:', {}))

      expect(results).toHaveLength(3)
      expect(results.map(r => r.name)).toContain('Alice')
      expect(results.map(r => r.name)).toContain('Bob')
      expect(results.map(r => r.name)).toContain('Charlie')
    })

    it('should filter by start timestamp', async () => {
      const store = createTestStore()
      const t1 = ts(-3000)
      const t2 = ts(-1000)
      const t3 = ts()

      await store.put('user:1', { name: 'Old', count: 1 }, t1)
      await store.put('user:2', { name: 'Medium', count: 2 }, t2)
      await store.put('user:3', { name: 'New', count: 3 }, t3)

      const results = await collectTestValues(
        store.range('user:', { start: t2 })
      )

      expect(results).toHaveLength(2)
      expect(results.map(r => r.name)).toContain('Medium')
      expect(results.map(r => r.name)).toContain('New')
    })

    it('should filter by end timestamp', async () => {
      const store = createTestStore()
      const t1 = ts(-3000)
      const t2 = ts(-1000)
      const t3 = ts()

      await store.put('user:1', { name: 'Old', count: 1 }, t1)
      await store.put('user:2', { name: 'Medium', count: 2 }, t2)
      await store.put('user:3', { name: 'New', count: 3 }, t3)

      const results = await collectTestValues(
        store.range('user:', { end: t2 })
      )

      expect(results).toHaveLength(2)
      expect(results.map(r => r.name)).toContain('Old')
      expect(results.map(r => r.name)).toContain('Medium')
    })

    it('should filter by both start and end timestamps', async () => {
      const store = createTestStore()
      const t1 = ts(-4000)
      const t2 = ts(-3000)
      const t3 = ts(-1000)
      const t4 = ts()

      await store.put('user:1', { name: 'VeryOld', count: 1 }, t1)
      await store.put('user:2', { name: 'Old', count: 2 }, t2)
      await store.put('user:3', { name: 'Recent', count: 3 }, t3)
      await store.put('user:4', { name: 'New', count: 4 }, t4)

      const results = await collectTestValues(
        store.range('user:', { start: t2, end: t3 })
      )

      expect(results).toHaveLength(2)
      expect(results.map(r => r.name)).toContain('Old')
      expect(results.map(r => r.name)).toContain('Recent')
    })

    it('should return empty iterator for non-matching prefix', async () => {
      const store = createTestStore()
      const timestamp = ts()

      await store.put('user:1', { name: 'Alice', count: 1 }, timestamp)

      const results = await collectTestValues(store.range('product:', {}))

      expect(results).toHaveLength(0)
    })

    it('should return empty iterator for time range with no matches', async () => {
      const store = createTestStore()
      const t1 = ts(-5000)
      const queryStart = ts(-3000)
      const queryEnd = ts(-2000)

      await store.put('user:1', { name: 'Alice', count: 1 }, t1)

      const results = await collectTestValues(
        store.range('user:', { start: queryStart, end: queryEnd })
      )

      expect(results).toHaveLength(0)
    })

    it('should handle empty prefix (match all)', async () => {
      const store = createTestStore()
      const timestamp = ts()

      await store.put('user:1', { name: 'Alice', count: 1 }, timestamp)
      await store.put('product:1', { name: 'Widget', count: 100 }, timestamp)

      const results = await collectTestValues(store.range('', {}))

      expect(results).toHaveLength(2)
    })

    it('should return latest version of each key within time range', async () => {
      const store = createTestStore()
      const t1 = ts(-3000)
      const t2 = ts(-1000)

      await store.put('user:1', { name: 'Alice V1', count: 1 }, t1)
      await store.put('user:1', { name: 'Alice V2', count: 2 }, t2)

      const results = await collectTestValues(
        store.range('user:', { start: t1, end: t2 })
      )

      // Should return only the latest version within range
      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('Alice V2')
    })

    it('should support iteration with async for...of', async () => {
      const store = createTestStore()
      const timestamp = ts()

      await store.put('item:1', { name: 'First', count: 1 }, timestamp)
      await store.put('item:2', { name: 'Second', count: 2 }, timestamp)

      const results: TestValue[] = []
      const iterator = store.range('item:', {})
      for await (const item of { [Symbol.asyncIterator]: () => iterator }) {
        results.push(item)
      }

      expect(results).toHaveLength(2)
    })
  })

  // ============================================================================
  // SNAPSHOT CREATION AND RESTORATION
  // ============================================================================

  describe('snapshot creation and restoration', () => {
    it('should create a snapshot and return a snapshot id', async () => {
      const store = createTestStore()
      const timestamp = ts()

      await store.put('user:1', { name: 'Alice', count: 1 }, timestamp)

      const snapshotId = await store.snapshot()

      expect(snapshotId).toBeDefined()
      expect(typeof snapshotId).toBe('string')
      expect(snapshotId.length).toBeGreaterThan(0)
    })

    it('should restore store to snapshot state', async () => {
      const store = createTestStore()
      const t1 = ts(-2000)
      const t2 = ts()

      await store.put('user:1', { name: 'Original', count: 1 }, t1)
      const snapshotId = await store.snapshot()

      await store.put('user:1', { name: 'Modified', count: 2 }, t2)

      // Verify modification
      expect((await store.get('user:1'))?.name).toBe('Modified')

      // Restore snapshot
      await store.restoreSnapshot(snapshotId)

      // Verify restoration
      const result = await store.get('user:1')
      expect(result?.name).toBe('Original')
      expect(result?.count).toBe(1)
    })

    it('should restore deleted keys', async () => {
      const store = createTestStore()
      const timestamp = ts()

      await store.put('user:1', { name: 'Alice', count: 1 }, timestamp)
      await store.put('user:2', { name: 'Bob', count: 2 }, timestamp)
      const snapshotId = await store.snapshot()

      // Simulate deletion by overwriting (if delete not supported, this tests overwrites)
      await store.put('user:1', null as unknown as TestValue, ts())

      await store.restoreSnapshot(snapshotId)

      const result = await store.get('user:1')
      expect(result?.name).toBe('Alice')
    })

    it('should throw error for invalid snapshot id', async () => {
      const store = createTestStore()

      await expect(store.restoreSnapshot('invalid-snapshot-id')).rejects.toThrow()
    })

    it('should list all available snapshots', async () => {
      const store = createTestStore()
      const timestamp = ts()

      await store.put('user:1', { name: 'Alice', count: 1 }, timestamp)
      await store.snapshot()

      await store.put('user:1', { name: 'Alice V2', count: 2 }, ts())
      await store.snapshot()

      const snapshots = await store.listSnapshots()

      expect(snapshots).toHaveLength(2)
      expect(snapshots[0]).toHaveProperty('id')
      expect(snapshots[0]).toHaveProperty('timestamp')
      expect(snapshots[0]).toHaveProperty('createdAt')
    })

    it('should return empty array when no snapshots exist', async () => {
      const store = createTestStore()

      const snapshots = await store.listSnapshots()

      expect(snapshots).toEqual([])
    })

    it('should preserve snapshot info with correct timestamps', async () => {
      const store = createTestStore()
      const beforeSnapshot = Date.now()

      await store.put('user:1', { name: 'Alice', count: 1 }, ts())
      const snapshotId = await store.snapshot()

      const afterSnapshot = Date.now()
      const snapshots = await store.listSnapshots()

      const snapshot = snapshots.find(s => s.id === snapshotId)
      expect(snapshot).toBeDefined()
      expect(snapshot!.createdAt).toBeGreaterThanOrEqual(beforeSnapshot)
      expect(snapshot!.createdAt).toBeLessThanOrEqual(afterSnapshot)
    })
  })

  // ============================================================================
  // MULTIPLE SNAPSHOTS (TIME TRAVEL TO ANY POINT)
  // ============================================================================

  describe('multiple snapshots (time travel to any point)', () => {
    it('should maintain multiple independent snapshots', async () => {
      const store = createTestStore()

      await store.put('counter', { name: 'counter', count: 1 }, ts(-3000))
      const snapshot1 = await store.snapshot()

      await store.put('counter', { name: 'counter', count: 2 }, ts(-2000))
      const snapshot2 = await store.snapshot()

      await store.put('counter', { name: 'counter', count: 3 }, ts(-1000))
      const snapshot3 = await store.snapshot()

      // Restore to middle snapshot
      await store.restoreSnapshot(snapshot2)
      expect((await store.get('counter'))?.count).toBe(2)

      // Restore to first snapshot
      await store.restoreSnapshot(snapshot1)
      expect((await store.get('counter'))?.count).toBe(1)

      // Restore to last snapshot
      await store.restoreSnapshot(snapshot3)
      expect((await store.get('counter'))?.count).toBe(3)
    })

    it('should allow restoration in any order', async () => {
      const store = createTestStore()

      await store.put('data', { name: 'A', count: 1 }, ts(-3000))
      const snapA = await store.snapshot()

      await store.put('data', { name: 'B', count: 2 }, ts(-2000))
      const snapB = await store.snapshot()

      await store.put('data', { name: 'C', count: 3 }, ts(-1000))
      const snapC = await store.snapshot()

      // Jump around non-sequentially
      await store.restoreSnapshot(snapC)
      expect((await store.get('data'))?.name).toBe('C')

      await store.restoreSnapshot(snapA)
      expect((await store.get('data'))?.name).toBe('A')

      await store.restoreSnapshot(snapB)
      expect((await store.get('data'))?.name).toBe('B')

      await store.restoreSnapshot(snapA)
      expect((await store.get('data'))?.name).toBe('A')
    })

    it('should preserve all keys in snapshot', async () => {
      const store = createTestStore()
      const timestamp = ts()

      await store.put('user:1', { name: 'Alice', count: 1 }, timestamp)
      await store.put('user:2', { name: 'Bob', count: 2 }, timestamp)
      await store.put('user:3', { name: 'Charlie', count: 3 }, timestamp)
      const snapshot = await store.snapshot()

      // Modify all keys
      await store.put('user:1', { name: 'Alice X', count: 10 }, ts())
      await store.put('user:2', { name: 'Bob X', count: 20 }, ts())
      await store.put('user:3', { name: 'Charlie X', count: 30 }, ts())

      await store.restoreSnapshot(snapshot)

      expect((await store.get('user:1'))?.name).toBe('Alice')
      expect((await store.get('user:2'))?.name).toBe('Bob')
      expect((await store.get('user:3'))?.name).toBe('Charlie')
    })

    it('should handle snapshot after restoring another snapshot', async () => {
      const store = createTestStore()

      await store.put('data', { name: 'Original', count: 1 }, ts(-2000))
      const originalSnapshot = await store.snapshot()

      await store.put('data', { name: 'Modified', count: 2 }, ts(-1000))

      // Restore original
      await store.restoreSnapshot(originalSnapshot)

      // Create new snapshot from restored state
      const newSnapshot = await store.snapshot()

      // Modify again
      await store.put('data', { name: 'NewModified', count: 3 }, ts())

      // Restore the new snapshot (which captured restored state)
      await store.restoreSnapshot(newSnapshot)

      expect((await store.get('data'))?.name).toBe('Original')
    })
  })

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('edge cases', () => {
    describe('empty store', () => {
      it('should handle get on empty store', async () => {
        const store = createTestStore()

        const result = await store.get('any-key')

        expect(result).toBeNull()
      })

      it('should handle getAsOf on empty store', async () => {
        const store = createTestStore()

        const result = await store.getAsOf('any-key', ts())

        expect(result).toBeNull()
      })

      it('should handle range on empty store', async () => {
        const store = createTestStore()

        const results = await collectTestValues(store.range('', {}))

        expect(results).toHaveLength(0)
      })

      it('should handle snapshot on empty store', async () => {
        const store = createTestStore()

        const snapshotId = await store.snapshot()

        expect(snapshotId).toBeDefined()
      })

      it('should handle listSnapshots on empty store', async () => {
        const store = createTestStore()

        const snapshots = await store.listSnapshots()

        expect(snapshots).toEqual([])
      })
    })

    describe('missing keys', () => {
      it('should return null consistently for missing key', async () => {
        const store = createTestStore()

        await store.put('exists', { name: 'exists', count: 1 }, ts())

        expect(await store.get('missing')).toBeNull()
        expect(await store.get('missing')).toBeNull() // Repeated call
      })

      it('should not confuse similar key prefixes', async () => {
        const store = createTestStore()
        const timestamp = ts()

        await store.put('user:1', { name: 'Alice', count: 1 }, timestamp)
        await store.put('user:10', { name: 'Bob', count: 10 }, timestamp)
        await store.put('user:100', { name: 'Charlie', count: 100 }, timestamp)

        expect((await store.get('user:1'))?.name).toBe('Alice')
        expect((await store.get('user:10'))?.name).toBe('Bob')
        expect((await store.get('user:100'))?.name).toBe('Charlie')
        expect(await store.get('user:')).toBeNull() // Just the prefix, not a key
      })
    })

    describe('future timestamps', () => {
      it('should handle put with future timestamp', async () => {
        const store = createTestStore()
        const futureTime = ts(86400000) // 1 day in future

        await store.put('user:1', { name: 'Future', count: 1 }, futureTime)

        const result = await store.get('user:1')
        expect(result?.name).toBe('Future')
      })

      it('should handle getAsOf with future timestamp', async () => {
        const store = createTestStore()
        const currentTime = ts()
        const futureTime = ts(86400000)

        await store.put('user:1', { name: 'Present', count: 1 }, currentTime)

        const result = await store.getAsOf('user:1', futureTime)
        expect(result?.name).toBe('Present')
      })

      it('should return null when querying past for future-only data', async () => {
        const store = createTestStore()
        const futureTime = ts(86400000)
        const currentTime = ts()

        await store.put('user:1', { name: 'Future', count: 1 }, futureTime)

        const result = await store.getAsOf('user:1', currentTime)
        expect(result).toBeNull()
      })
    })

    describe('timestamp boundaries', () => {
      it('should handle timestamp of 0', async () => {
        const store = createTestStore()

        await store.put('key', { name: 'Epoch', count: 0 }, 0)

        expect((await store.getAsOf('key', 0))?.name).toBe('Epoch')
      })

      it('should handle very large timestamps', async () => {
        const store = createTestStore()
        const largeTimestamp = Number.MAX_SAFE_INTEGER

        await store.put('key', { name: 'Max', count: 1 }, largeTimestamp)

        expect((await store.getAsOf('key', largeTimestamp))?.name).toBe('Max')
      })

      it('should handle timestamps with millisecond precision', async () => {
        const store = createTestStore()
        const t1 = 1704067200000 // 2024-01-01 00:00:00.000 UTC
        const t2 = 1704067200001 // 2024-01-01 00:00:00.001 UTC

        await store.put('key', { name: 'T1', count: 1 }, t1)
        await store.put('key', { name: 'T2', count: 2 }, t2)

        expect((await store.getAsOf('key', t1))?.name).toBe('T1')
        expect((await store.getAsOf('key', t2))?.name).toBe('T2')
      })
    })

    describe('value edge cases', () => {
      it('should handle value with null fields', async () => {
        const store = createTemporalStore<{ name: string | null; count: number }>()
        const timestamp = ts()

        await store.put('key', { name: null, count: 1 }, timestamp)

        const result = await store.get('key')
        expect(result?.name).toBeNull()
        expect(result?.count).toBe(1)
      })

      it('should handle value with undefined fields (optional)', async () => {
        const store = createTestStore()
        const timestamp = ts()

        await store.put('key', { name: 'Test', count: 1 }, timestamp) // No tags

        const result = await store.get('key')
        expect(result?.tags).toBeUndefined()
      })

      it('should handle empty arrays', async () => {
        const store = createTestStore()
        const timestamp = ts()

        await store.put('key', { name: 'Empty', count: 0, tags: [] }, timestamp)

        const result = await store.get('key')
        expect(result?.tags).toEqual([])
      })
    })
  })

  // ============================================================================
  // CONCURRENT OPERATIONS
  // ============================================================================

  describe('concurrent operations', () => {
    it('should handle concurrent puts to different keys', async () => {
      const store = createTestStore()
      const timestamp = ts()

      await Promise.all([
        store.put('user:1', { name: 'Alice', count: 1 }, timestamp),
        store.put('user:2', { name: 'Bob', count: 2 }, timestamp),
        store.put('user:3', { name: 'Charlie', count: 3 }, timestamp),
        store.put('user:4', { name: 'Diana', count: 4 }, timestamp),
        store.put('user:5', { name: 'Eve', count: 5 }, timestamp),
      ])

      const results = await Promise.all([
        store.get('user:1'),
        store.get('user:2'),
        store.get('user:3'),
        store.get('user:4'),
        store.get('user:5'),
      ])

      expect(results[0]?.name).toBe('Alice')
      expect(results[1]?.name).toBe('Bob')
      expect(results[2]?.name).toBe('Charlie')
      expect(results[3]?.name).toBe('Diana')
      expect(results[4]?.name).toBe('Eve')
    })

    it('should handle concurrent puts to same key (last writer wins based on timestamp)', async () => {
      const store = createTestStore()

      // All with different timestamps
      await Promise.all([
        store.put('key', { name: 'First', count: 1 }, ts(-300)),
        store.put('key', { name: 'Second', count: 2 }, ts(-200)),
        store.put('key', { name: 'Third', count: 3 }, ts(-100)),
        store.put('key', { name: 'Fourth', count: 4 }, ts()),
      ])

      const result = await store.get('key')
      expect(result?.name).toBe('Fourth') // Latest timestamp wins
    })

    it('should handle concurrent gets', async () => {
      const store = createTestStore()
      const timestamp = ts()

      await store.put('key', { name: 'Value', count: 42 }, timestamp)

      const results = await Promise.all([
        store.get('key'),
        store.get('key'),
        store.get('key'),
        store.get('key'),
        store.get('key'),
      ])

      results.forEach(r => {
        expect(r?.name).toBe('Value')
        expect(r?.count).toBe(42)
      })
    })

    it('should handle concurrent getAsOf queries', async () => {
      const store = createTestStore()
      const t1 = ts(-1000)
      const t2 = ts()

      await store.put('key', { name: 'Old', count: 1 }, t1)
      await store.put('key', { name: 'New', count: 2 }, t2)

      const results = await Promise.all([
        store.getAsOf('key', t1),
        store.getAsOf('key', t2),
        store.getAsOf('key', t1),
        store.getAsOf('key', t2),
      ])

      expect(results[0]?.name).toBe('Old')
      expect(results[1]?.name).toBe('New')
      expect(results[2]?.name).toBe('Old')
      expect(results[3]?.name).toBe('New')
    })

    it('should handle concurrent reads and writes', async () => {
      const store = createTestStore()

      await store.put('key', { name: 'Initial', count: 0 }, ts(-1000))

      const operations = Array.from({ length: 10 }, (_, i) =>
        i % 2 === 0
          ? store.put('key', { name: `Write${i}`, count: i }, ts() + i)
          : store.get('key')
      )

      await Promise.all(operations)

      // Final state should be consistent
      const result = await store.get('key')
      expect(result).not.toBeNull()
      expect(typeof result?.name).toBe('string')
    })

    it('should handle concurrent snapshot operations', async () => {
      const store = createTestStore()
      const timestamp = ts()

      await store.put('data', { name: 'Data', count: 1 }, timestamp)

      const [snap1, snap2, snap3] = await Promise.all([
        store.snapshot(),
        store.snapshot(),
        store.snapshot(),
      ])

      expect(snap1).toBeDefined()
      expect(snap2).toBeDefined()
      expect(snap3).toBeDefined()

      // Each should be unique (or implementation may reuse if content identical)
      const snapshots = await store.listSnapshots()
      expect(snapshots.length).toBeGreaterThanOrEqual(1)
    })
  })

  // ============================================================================
  // TTL/EXPIRATION BEHAVIOR
  // ============================================================================

  describe('TTL/expiration behavior', () => {
    it('should support optional TTL on put', async () => {
      const store = createTemporalStore<TestValue>({ enableTTL: true })
      const timestamp = ts()
      const ttlMs = 1000 // 1 second TTL

      await store.put('key', { name: 'Temporary', count: 1 }, timestamp, { ttl: ttlMs })

      // Immediately available
      expect((await store.get('key'))?.name).toBe('Temporary')
    })

    it('should expire values after TTL', async () => {
      vi.useFakeTimers()

      try {
        const store = createTemporalStore<TestValue>({ enableTTL: true })
        const timestamp = Date.now()
        const ttlMs = 1000

        await store.put('key', { name: 'Temporary', count: 1 }, timestamp, { ttl: ttlMs })

        // Available before expiration
        expect((await store.get('key'))?.name).toBe('Temporary')

        // Advance time past TTL
        vi.advanceTimersByTime(ttlMs + 100)

        // Should be expired
        const result = await store.get('key')
        expect(result).toBeNull()
      } finally {
        vi.useRealTimers()
      }
    })

    it('should allow getAsOf for expired values at historical timestamps', async () => {
      vi.useFakeTimers()

      try {
        const store = createTemporalStore<TestValue>({ enableTTL: true })
        const timestamp = Date.now()
        const ttlMs = 1000

        await store.put('key', { name: 'Expired', count: 1 }, timestamp, { ttl: ttlMs })

        // Advance time past TTL
        vi.advanceTimersByTime(ttlMs + 100)

        // Current value should be null (expired)
        expect(await store.get('key')).toBeNull()

        // But historical query should still work
        const historical = await store.getAsOf('key', timestamp)
        expect(historical?.name).toBe('Expired')
      } finally {
        vi.useRealTimers()
      }
    })

    it('should update TTL when overwriting value', async () => {
      vi.useFakeTimers()

      try {
        const store = createTemporalStore<TestValue>({ enableTTL: true })
        const timestamp = Date.now()

        await store.put('key', { name: 'Short', count: 1 }, timestamp, { ttl: 500 })
        await store.put('key', { name: 'Long', count: 2 }, timestamp + 100, { ttl: 5000 })

        // Advance past first TTL but not second
        vi.advanceTimersByTime(1000)

        const result = await store.get('key')
        expect(result?.name).toBe('Long')
      } finally {
        vi.useRealTimers()
      }
    })

    it('should exclude expired values from range queries', async () => {
      vi.useFakeTimers()

      try {
        const store = createTemporalStore<TestValue>({ enableTTL: true })
        const timestamp = Date.now()

        await store.put('item:1', { name: 'Permanent', count: 1 }, timestamp)
        await store.put('item:2', { name: 'Temporary', count: 2 }, timestamp, { ttl: 500 })

        vi.advanceTimersByTime(1000)

        const results = await collectTestValues(store.range('item:', {}))

        expect(results).toHaveLength(1)
        expect(results[0].name).toBe('Permanent')
      } finally {
        vi.useRealTimers()
      }
    })
  })

  // ============================================================================
  // OVERWRITING SAME KEY WITH DIFFERENT TIMESTAMPS
  // ============================================================================

  describe('overwriting same key with different timestamps', () => {
    it('should maintain version history', async () => {
      const store = createTestStore()

      await store.put('key', { name: 'V1', count: 1 }, ts(-3000))
      await store.put('key', { name: 'V2', count: 2 }, ts(-2000))
      await store.put('key', { name: 'V3', count: 3 }, ts(-1000))
      await store.put('key', { name: 'V4', count: 4 }, ts())

      // All versions should be queryable
      expect((await store.getAsOf('key', ts(-3000)))?.name).toBe('V1')
      expect((await store.getAsOf('key', ts(-2000)))?.name).toBe('V2')
      expect((await store.getAsOf('key', ts(-1000)))?.name).toBe('V3')
      expect((await store.getAsOf('key', ts()))?.name).toBe('V4')
    })

    it('should handle out-of-order timestamp writes', async () => {
      const store = createTestStore()

      // Write in non-chronological order
      await store.put('key', { name: 'T2', count: 2 }, ts(-2000))
      await store.put('key', { name: 'T4', count: 4 }, ts())
      await store.put('key', { name: 'T1', count: 1 }, ts(-3000))
      await store.put('key', { name: 'T3', count: 3 }, ts(-1000))

      // Queries should still return correct temporal order
      expect((await store.getAsOf('key', ts(-3000)))?.name).toBe('T1')
      expect((await store.getAsOf('key', ts(-2000)))?.name).toBe('T2')
      expect((await store.getAsOf('key', ts(-1000)))?.name).toBe('T3')
      expect((await store.get('key'))?.name).toBe('T4')
    })

    it('should handle same timestamp overwrites (last write wins)', async () => {
      const store = createTestStore()
      const sameTime = ts()

      await store.put('key', { name: 'First', count: 1 }, sameTime)
      await store.put('key', { name: 'Second', count: 2 }, sameTime)

      // Last write with same timestamp wins
      const result = await store.get('key')
      expect(result?.name).toBe('Second')
    })

    it('should handle idempotent writes (same value, same timestamp)', async () => {
      const store = createTestStore()
      const timestamp = ts()
      const value = { name: 'Same', count: 42 }

      await store.put('key', value, timestamp)
      await store.put('key', value, timestamp)
      await store.put('key', value, timestamp)

      const result = await store.get('key')
      expect(result).toEqual(value)
    })

    it('should allow reverting to earlier value via new write', async () => {
      const store = createTestStore()

      await store.put('key', { name: 'Original', count: 1 }, ts(-2000))
      await store.put('key', { name: 'Changed', count: 2 }, ts(-1000))
      await store.put('key', { name: 'Original', count: 1 }, ts()) // Revert content

      const result = await store.get('key')
      expect(result?.name).toBe('Original')
      expect(result?.count).toBe(1)

      // But historical query shows the change happened
      expect((await store.getAsOf('key', ts(-1000)))?.name).toBe('Changed')
    })

    it('should track modification count/versions', async () => {
      const store = createTestStore()

      await store.put('key', { name: 'V1', count: 1 }, ts(-4000))
      await store.put('key', { name: 'V2', count: 2 }, ts(-3000))
      await store.put('key', { name: 'V3', count: 3 }, ts(-2000))
      await store.put('key', { name: 'V4', count: 4 }, ts(-1000))
      await store.put('key', { name: 'V5', count: 5 }, ts())

      // Range over all time should show version progression
      const results = await collectTestValues(
        store.range('key', { start: ts(-4000), end: ts() })
      )

      // Should return latest version within range
      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('V5')
    })
  })

  // ============================================================================
  // PERFORMANCE TEST PLACEHOLDERS
  // ============================================================================

  describe('performance tests (large datasets)', () => {
    it.skip('should handle 10,000 keys efficiently', async () => {
      const store = createTestStore()
      const timestamp = ts()

      // Insert 10k keys
      const insertStart = performance.now()
      for (let i = 0; i < 10000; i++) {
        await store.put(`key:${i}`, { name: `Value ${i}`, count: i }, timestamp)
      }
      const insertTime = performance.now() - insertStart

      // Random lookups
      const lookupStart = performance.now()
      for (let i = 0; i < 1000; i++) {
        const randomKey = `key:${Math.floor(Math.random() * 10000)}`
        await store.get(randomKey)
      }
      const lookupTime = performance.now() - lookupStart

      // Performance assertions (adjust thresholds as needed)
      expect(insertTime).toBeLessThan(5000) // 5 seconds for 10k inserts
      expect(lookupTime).toBeLessThan(1000) // 1 second for 1k lookups
    })

    it.skip('should handle keys with 100 versions each', async () => {
      const store = createTestStore()
      const keyCount = 100
      const versionsPerKey = 100

      // Insert keys with many versions
      for (let k = 0; k < keyCount; k++) {
        for (let v = 0; v < versionsPerKey; v++) {
          await store.put(
            `key:${k}`,
            { name: `Key ${k} Version ${v}`, count: v },
            ts() - (versionsPerKey - v) * 1000
          )
        }
      }

      // Time-travel query performance
      const queryStart = performance.now()
      for (let k = 0; k < keyCount; k++) {
        const randomVersion = Math.floor(Math.random() * versionsPerKey)
        await store.getAsOf(`key:${k}`, ts() - (versionsPerKey - randomVersion) * 1000)
      }
      const queryTime = performance.now() - queryStart

      expect(queryTime).toBeLessThan(5000) // 5 seconds for 100 queries
    })

    it.skip('should handle range queries over large datasets', async () => {
      const store = createTestStore()
      const timestamp = ts()

      // Insert 10k keys with common prefix
      for (let i = 0; i < 10000; i++) {
        await store.put(`user:${i}`, { name: `User ${i}`, count: i }, timestamp)
      }

      // Range query performance
      const rangeStart = performance.now()
      const results = await collectTestValues(store.range('user:', {}))
      const rangeTime = performance.now() - rangeStart

      expect(results).toHaveLength(10000)
      expect(rangeTime).toBeLessThan(2000) // 2 seconds
    })

    it.skip('should handle snapshot operations on large store', async () => {
      const store = createTestStore()
      const timestamp = ts()

      // Insert 1000 keys
      for (let i = 0; i < 1000; i++) {
        await store.put(`key:${i}`, { name: `Value ${i}`, count: i }, timestamp)
      }

      // Snapshot performance
      const snapshotStart = performance.now()
      const snapshotId = await store.snapshot()
      const snapshotTime = performance.now() - snapshotStart

      // Modify some data
      for (let i = 0; i < 100; i++) {
        await store.put(`key:${i}`, { name: `Modified ${i}`, count: i * 10 }, ts())
      }

      // Restore performance
      const restoreStart = performance.now()
      await store.restoreSnapshot(snapshotId)
      const restoreTime = performance.now() - restoreStart

      expect(snapshotTime).toBeLessThan(1000) // 1 second
      expect(restoreTime).toBeLessThan(2000) // 2 seconds

      // Verify restoration
      expect((await store.get('key:0'))?.name).toBe('Value 0')
    })

    it.skip('should maintain performance with many snapshots', async () => {
      const store = createTestStore()

      // Create 100 snapshots with modifications between each
      const snapshots: SnapshotId[] = []
      for (let i = 0; i < 100; i++) {
        await store.put('counter', { name: 'counter', count: i }, ts() + i)
        snapshots.push(await store.snapshot())
      }

      // List snapshots performance
      const listStart = performance.now()
      const allSnapshots = await store.listSnapshots()
      const listTime = performance.now() - listStart

      expect(allSnapshots).toHaveLength(100)
      expect(listTime).toBeLessThan(500) // 500ms

      // Random snapshot restoration performance
      const restoreStart = performance.now()
      const randomSnapshot = snapshots[Math.floor(Math.random() * snapshots.length)]
      await store.restoreSnapshot(randomSnapshot)
      const restoreTime = performance.now() - restoreStart

      expect(restoreTime).toBeLessThan(500) // 500ms
    })
  })

  // ============================================================================
  // TYPE SAFETY TESTS
  // ============================================================================

  describe('type safety', () => {
    it('should enforce generic type on put', async () => {
      const store = createTemporalStore<{ id: number; active: boolean }>()

      // This should type-check
      await store.put('key', { id: 1, active: true }, ts())

      const result = await store.get('key')

      // Type inference should work
      if (result) {
        const id: number = result.id
        const active: boolean = result.active
        expect(id).toBe(1)
        expect(active).toBe(true)
      }
    })

    it('should preserve type through getAsOf', async () => {
      interface CustomType {
        nested: { value: string }
        items: number[]
      }

      const store = createTemporalStore<CustomType>()
      await store.put('key', { nested: { value: 'test' }, items: [1, 2, 3] }, ts())

      const result = await store.getAsOf('key', ts())

      if (result) {
        // Type inference for nested properties
        const nestedValue: string = result.nested.value
        const firstItem: number = result.items[0]
        expect(nestedValue).toBe('test')
        expect(firstItem).toBe(1)
      }
    })

    it('should type range iterator correctly', async () => {
      interface User {
        username: string
        email: string
      }

      const store = createTemporalStore<User>()
      await store.put('user:1', { username: 'alice', email: 'alice@test.com' }, ts())

      const iterator = store.range('user:', {})
      const result = await iterator.next()

      if (!result.done) {
        // Type should be User
        const username: string = result.value.username
        expect(username).toBe('alice')
      }
    })
  })
})
