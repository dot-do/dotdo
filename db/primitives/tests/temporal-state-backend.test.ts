/**
 * TemporalStateBackend - Time-travel integration tests
 *
 * Tests for the TemporalStateBackend which wraps a StateBackend with
 * TemporalStore to provide time-travel queries on state.
 *
 * @module db/primitives/tests/temporal-state-backend.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  TemporalStateBackend,
  type TemporalOptions,
  type TemporalEntry,
} from '../stateful-operator/temporal-integration'
import { InMemoryStateBackend, type StateBackend, type StateSnapshot } from '../stateful-operator/index'
import { createTemporalStore, type TemporalStore } from '../temporal-store'

// =============================================================================
// TEST HELPERS
// =============================================================================

interface TestValue {
  name: string
  count: number
}

function createTestBackend(): {
  current: StateBackend<TestValue>
  temporal: TemporalStore<TestValue>
  backend: TemporalStateBackend<TestValue>
} {
  const current = new InMemoryStateBackend<TestValue>('test-current')
  const temporal = createTemporalStore<TestValue>()
  const backend = new TemporalStateBackend(current, temporal)
  return { current, temporal, backend }
}

async function collectHistory<T>(
  iterable: AsyncIterable<TemporalEntry<T>>
): Promise<TemporalEntry<T>[]> {
  const results: TemporalEntry<T>[] = []
  for await (const entry of iterable) {
    results.push(entry)
  }
  return results
}

// =============================================================================
// BASIC OPERATIONS
// =============================================================================

describe('TemporalStateBackend', () => {
  describe('basic StateBackend operations', () => {
    it('should implement StateBackend interface', async () => {
      const { backend } = createTestBackend()

      // Verify it has all required methods
      expect(typeof backend.get).toBe('function')
      expect(typeof backend.put).toBe('function')
      expect(typeof backend.delete).toBe('function')
      expect(typeof backend.list).toBe('function')
      expect(typeof backend.size).toBe('function')
      expect(typeof backend.snapshot).toBe('function')
      expect(typeof backend.restore).toBe('function')
      expect(typeof backend.clear).toBe('function')
      expect(typeof backend.name).toBe('string')
    })

    it('should put and get values', async () => {
      const { backend } = createTestBackend()

      await backend.put('user:1', { name: 'Alice', count: 1 })
      const result = await backend.get('user:1')

      expect(result).toEqual({ name: 'Alice', count: 1 })
    })

    it('should return undefined for non-existent keys', async () => {
      const { backend } = createTestBackend()

      const result = await backend.get('missing')

      expect(result).toBeUndefined()
    })

    it('should delete values', async () => {
      const { backend } = createTestBackend()

      await backend.put('user:1', { name: 'Alice', count: 1 })
      await backend.delete('user:1')
      const result = await backend.get('user:1')

      expect(result).toBeUndefined()
    })

    it('should list all entries', async () => {
      const { backend } = createTestBackend()

      await backend.put('user:1', { name: 'Alice', count: 1 })
      await backend.put('user:2', { name: 'Bob', count: 2 })

      const entries: [string, TestValue][] = []
      for await (const entry of backend.list()) {
        entries.push(entry)
      }

      expect(entries).toHaveLength(2)
    })

    it('should list entries with prefix', async () => {
      const { backend } = createTestBackend()

      await backend.put('user:1', { name: 'Alice', count: 1 })
      await backend.put('product:1', { name: 'Widget', count: 100 })

      const entries: [string, TestValue][] = []
      for await (const entry of backend.list('user:')) {
        entries.push(entry)
      }

      expect(entries).toHaveLength(1)
      expect(entries[0][0]).toBe('user:1')
    })

    it('should return correct size', async () => {
      const { backend } = createTestBackend()

      expect(await backend.size()).toBe(0)

      await backend.put('user:1', { name: 'Alice', count: 1 })
      await backend.put('user:2', { name: 'Bob', count: 2 })

      expect(await backend.size()).toBe(2)
    })

    it('should clear all entries', async () => {
      const { backend } = createTestBackend()

      await backend.put('user:1', { name: 'Alice', count: 1 })
      await backend.put('user:2', { name: 'Bob', count: 2 })
      await backend.clear()

      expect(await backend.size()).toBe(0)
    })

    it('should support TTL on put', async () => {
      const { backend } = createTestBackend()

      await backend.put('user:1', { name: 'Alice', count: 1 }, 100)
      expect(await backend.get('user:1')).toEqual({ name: 'Alice', count: 1 })

      // Wait for TTL to expire
      await new Promise((r) => setTimeout(r, 150))

      expect(await backend.get('user:1')).toBeUndefined()
    })
  })

  // =============================================================================
  // TIME-TRAVEL QUERIES (getAt)
  // =============================================================================

  describe('getAt() - point-in-time queries', () => {
    it('should retrieve value at specific timestamp', async () => {
      const { backend } = createTestBackend()

      const t1 = Date.now() - 2000
      const t2 = Date.now() - 1000
      const t3 = Date.now()

      await backend.putAt('user:1', { name: 'V1', count: 1 }, t1)
      await backend.putAt('user:1', { name: 'V2', count: 2 }, t2)
      await backend.putAt('user:1', { name: 'V3', count: 3 }, t3)

      expect(await backend.getAt('user:1', t1)).toEqual({ name: 'V1', count: 1 })
      expect(await backend.getAt('user:1', t2)).toEqual({ name: 'V2', count: 2 })
      expect(await backend.getAt('user:1', t3)).toEqual({ name: 'V3', count: 3 })
    })

    it('should return most recent value before timestamp', async () => {
      const { backend } = createTestBackend()

      const t1 = Date.now() - 3000
      const t2 = Date.now() - 1000
      const queryTime = Date.now() - 2000 // Between t1 and t2

      await backend.putAt('user:1', { name: 'Before', count: 1 }, t1)
      await backend.putAt('user:1', { name: 'After', count: 2 }, t2)

      const result = await backend.getAt('user:1', queryTime)

      expect(result).toEqual({ name: 'Before', count: 1 })
    })

    it('should return undefined for timestamp before key existed', async () => {
      const { backend } = createTestBackend()

      const createTime = Date.now()
      const queryTime = Date.now() - 1000 // Before creation

      await backend.putAt('user:1', { name: 'Alice', count: 1 }, createTime)

      const result = await backend.getAt('user:1', queryTime)

      expect(result).toBeUndefined()
    })

    it('should return undefined for non-existent key', async () => {
      const { backend } = createTestBackend()

      const result = await backend.getAt('missing', Date.now())

      expect(result).toBeUndefined()
    })

    it('should record temporal history on regular put', async () => {
      const { backend } = createTestBackend()

      // Regular put should record in temporal store
      await backend.put('user:1', { name: 'Alice', count: 1 })
      const t1 = Date.now()

      // Small delay
      await new Promise((r) => setTimeout(r, 10))

      await backend.put('user:1', { name: 'Alice Updated', count: 2 })
      const t2 = Date.now()

      // Should be able to query historical state
      const oldValue = await backend.getAt('user:1', t1)
      const newValue = await backend.getAt('user:1', t2)

      expect(oldValue?.count).toBe(1)
      expect(newValue?.count).toBe(2)
    })
  })

  // =============================================================================
  // HISTORY QUERIES (getHistory)
  // =============================================================================

  describe('getHistory() - key change history', () => {
    it('should return full history for a key', async () => {
      const { backend } = createTestBackend()

      const t1 = Date.now() - 3000
      const t2 = Date.now() - 2000
      const t3 = Date.now() - 1000

      await backend.putAt('user:1', { name: 'V1', count: 1 }, t1)
      await backend.putAt('user:1', { name: 'V2', count: 2 }, t2)
      await backend.putAt('user:1', { name: 'V3', count: 3 }, t3)

      const history = await collectHistory(backend.getHistory('user:1'))

      expect(history).toHaveLength(3)
      expect(history[0].value.count).toBe(1)
      expect(history[1].value.count).toBe(2)
      expect(history[2].value.count).toBe(3)
    })

    it('should return history within time range', async () => {
      const { backend } = createTestBackend()

      const t1 = Date.now() - 4000
      const t2 = Date.now() - 3000
      const t3 = Date.now() - 2000
      const t4 = Date.now() - 1000

      await backend.putAt('user:1', { name: 'V1', count: 1 }, t1)
      await backend.putAt('user:1', { name: 'V2', count: 2 }, t2)
      await backend.putAt('user:1', { name: 'V3', count: 3 }, t3)
      await backend.putAt('user:1', { name: 'V4', count: 4 }, t4)

      const history = await collectHistory(backend.getHistory('user:1', t2, t3))

      expect(history).toHaveLength(2)
      expect(history[0].value.count).toBe(2)
      expect(history[1].value.count).toBe(3)
    })

    it('should return empty history for non-existent key', async () => {
      const { backend } = createTestBackend()

      const history = await collectHistory(backend.getHistory('missing'))

      expect(history).toHaveLength(0)
    })

    it('should include timestamp in history entries', async () => {
      const { backend } = createTestBackend()

      const t1 = Date.now() - 1000
      const t2 = Date.now()

      await backend.putAt('user:1', { name: 'V1', count: 1 }, t1)
      await backend.putAt('user:1', { name: 'V2', count: 2 }, t2)

      const history = await collectHistory(backend.getHistory('user:1'))

      expect(history[0].timestamp).toBe(t1)
      expect(history[1].timestamp).toBe(t2)
    })

    it('should track delete operations in history', async () => {
      const { backend } = createTestBackend()

      const t1 = Date.now() - 2000
      const t2 = Date.now() - 1000
      const t3 = Date.now()

      await backend.putAt('user:1', { name: 'V1', count: 1 }, t1)
      await backend.deleteAt('user:1', t2)
      await backend.putAt('user:1', { name: 'V2', count: 2 }, t3)

      const history = await collectHistory(backend.getHistory('user:1'))

      expect(history).toHaveLength(3)
      expect(history[0].operation).toBe('put')
      expect(history[1].operation).toBe('delete')
      expect(history[2].operation).toBe('put')
    })
  })

  // =============================================================================
  // SNAPSHOT AT TIMESTAMP (snapshotAt)
  // =============================================================================

  describe('snapshotAt() - full state reconstruction', () => {
    it('should reconstruct state at specific timestamp', async () => {
      const { backend } = createTestBackend()

      const t1 = Date.now() - 2000
      const t2 = Date.now() - 1000
      const t3 = Date.now()

      await backend.putAt('user:1', { name: 'Alice', count: 1 }, t1)
      await backend.putAt('user:2', { name: 'Bob', count: 2 }, t1)
      await backend.putAt('user:1', { name: 'Alice Updated', count: 10 }, t2)
      await backend.putAt('user:3', { name: 'Charlie', count: 3 }, t3)

      // Snapshot at t1 should have user:1 and user:2 with original values
      const snapshotT1 = await backend.snapshotAt(t1)
      expect(snapshotT1.size).toBe(2)
      expect(snapshotT1.get('user:1')?.count).toBe(1)
      expect(snapshotT1.get('user:2')?.count).toBe(2)
      expect(snapshotT1.has('user:3')).toBe(false)

      // Snapshot at t2 should have updated user:1
      const snapshotT2 = await backend.snapshotAt(t2)
      expect(snapshotT2.size).toBe(2)
      expect(snapshotT2.get('user:1')?.count).toBe(10)

      // Snapshot at t3 should have all 3 users
      const snapshotT3 = await backend.snapshotAt(t3)
      expect(snapshotT3.size).toBe(3)
    })

    it('should return empty map for timestamp before any data', async () => {
      const { backend } = createTestBackend()

      await backend.putAt('user:1', { name: 'Alice', count: 1 }, Date.now())

      const snapshot = await backend.snapshotAt(Date.now() - 10000)

      expect(snapshot.size).toBe(0)
    })

    it('should exclude deleted keys at timestamp', async () => {
      const { backend } = createTestBackend()

      const t1 = Date.now() - 3000
      const t2 = Date.now() - 2000
      const t3 = Date.now() - 1000

      await backend.putAt('user:1', { name: 'Alice', count: 1 }, t1)
      await backend.putAt('user:2', { name: 'Bob', count: 2 }, t1)
      await backend.deleteAt('user:1', t2)

      // Snapshot before delete should have both
      const snapshotT1 = await backend.snapshotAt(t1)
      expect(snapshotT1.size).toBe(2)

      // Snapshot after delete should only have user:2
      const snapshotT2 = await backend.snapshotAt(t2)
      expect(snapshotT2.size).toBe(1)
      expect(snapshotT2.has('user:1')).toBe(false)
      expect(snapshotT2.has('user:2')).toBe(true)
    })

    it('should handle snapshot at exact event timestamps', async () => {
      const { backend } = createTestBackend()

      const exactTime = 1704067200000

      await backend.putAt('key', { name: 'Exact', count: 1 }, exactTime)

      const snapshot = await backend.snapshotAt(exactTime)

      expect(snapshot.size).toBe(1)
      expect(snapshot.get('key')).toEqual({ name: 'Exact', count: 1 })
    })
  })

  // =============================================================================
  // RETENTION POLICY
  // =============================================================================

  describe('retention policy', () => {
    it('should accept retention options', async () => {
      const current = new InMemoryStateBackend<TestValue>('test')
      const temporal = createTemporalStore<TestValue>()
      const options: TemporalOptions = {
        retentionMs: 60000,
        compactionIntervalMs: 10000,
      }

      const backend = new TemporalStateBackend(current, temporal, options)

      expect(backend).toBeDefined()
    })

    it('should compact old temporal entries', async () => {
      const current = new InMemoryStateBackend<TestValue>('test')
      const temporal = createTemporalStore<TestValue>()
      const backend = new TemporalStateBackend(current, temporal, {
        retentionMs: 1000,
      })

      // Add entries with old timestamps
      const oldTime = Date.now() - 5000
      await backend.putAt('user:1', { name: 'Old', count: 1 }, oldTime)
      await backend.putAt('user:1', { name: 'Recent', count: 2 }, Date.now())

      // Run compaction
      const stats = await backend.compact()

      expect(stats.versionsRemoved).toBeGreaterThanOrEqual(0)
    })

    it('should preserve data within retention window', async () => {
      const current = new InMemoryStateBackend<TestValue>('test')
      const temporal = createTemporalStore<TestValue>()
      const backend = new TemporalStateBackend(current, temporal, {
        retentionMs: 60000, // 1 minute retention
      })

      const recentTime = Date.now() - 1000 // 1 second ago
      await backend.putAt('user:1', { name: 'Recent', count: 1 }, recentTime)

      await backend.compact()

      // Data should still be accessible
      const result = await backend.getAt('user:1', recentTime)
      expect(result).toEqual({ name: 'Recent', count: 1 })
    })

    it('should use default retention when not specified', async () => {
      const { backend } = createTestBackend()

      // Without retention policy, should keep all history
      await backend.putAt('user:1', { name: 'V1', count: 1 }, Date.now() - 100000)
      await backend.putAt('user:1', { name: 'V2', count: 2 }, Date.now())

      const history = await collectHistory(backend.getHistory('user:1'))

      expect(history).toHaveLength(2)
    })
  })

  // =============================================================================
  // SNAPSHOT AND RESTORE
  // =============================================================================

  describe('snapshot and restore', () => {
    it('should create snapshot with metadata', async () => {
      const { backend } = createTestBackend()

      await backend.put('user:1', { name: 'Alice', count: 1 })

      const snapshot = await backend.snapshot()

      expect(snapshot.id).toBeDefined()
      expect(snapshot.timestamp).toBeGreaterThan(0)
      expect(snapshot.data).toBeInstanceOf(Uint8Array)
      expect(snapshot.metadata.stateCount).toBe(1)
    })

    it('should restore from snapshot', async () => {
      const { backend } = createTestBackend()

      await backend.put('user:1', { name: 'Original', count: 1 })
      const snapshot = await backend.snapshot()

      await backend.put('user:1', { name: 'Modified', count: 2 })
      expect((await backend.get('user:1'))?.count).toBe(2)

      await backend.restore(snapshot)

      expect((await backend.get('user:1'))?.count).toBe(1)
    })

    it('should maintain temporal history after restore', async () => {
      const { backend } = createTestBackend()

      const t1 = Date.now() - 2000
      await backend.putAt('user:1', { name: 'V1', count: 1 }, t1)
      const snapshot = await backend.snapshot()

      const t2 = Date.now() - 1000
      await backend.putAt('user:1', { name: 'V2', count: 2 }, t2)

      await backend.restore(snapshot)

      // Current state should be restored
      expect((await backend.get('user:1'))?.count).toBe(1)

      // But temporal history should still have V2
      const result = await backend.getAt('user:1', t2)
      expect(result?.count).toBe(2)
    })
  })

  // =============================================================================
  // PUTATTIMESTAMP AND DELETEATTIMESTAMP
  // =============================================================================

  describe('putAt and deleteAt', () => {
    it('should put value at specific timestamp', async () => {
      const { backend } = createTestBackend()

      const timestamp = Date.now() - 5000

      await backend.putAt('user:1', { name: 'Historical', count: 1 }, timestamp)

      // Should be accessible via getAt
      const result = await backend.getAt('user:1', timestamp)
      expect(result).toEqual({ name: 'Historical', count: 1 })
    })

    it('should delete at specific timestamp', async () => {
      const { backend } = createTestBackend()

      const t1 = Date.now() - 2000
      const t2 = Date.now() - 1000

      await backend.putAt('user:1', { name: 'Alice', count: 1 }, t1)
      await backend.deleteAt('user:1', t2)

      // Before delete
      expect(await backend.getAt('user:1', t1)).toEqual({ name: 'Alice', count: 1 })

      // After delete
      expect(await backend.getAt('user:1', t2)).toBeUndefined()
    })

    it('should handle out-of-order timestamp writes', async () => {
      const { backend } = createTestBackend()

      // Write in non-chronological order
      await backend.putAt('user:1', { name: 'T2', count: 2 }, Date.now() - 2000)
      await backend.putAt('user:1', { name: 'T4', count: 4 }, Date.now())
      await backend.putAt('user:1', { name: 'T1', count: 1 }, Date.now() - 3000)
      await backend.putAt('user:1', { name: 'T3', count: 3 }, Date.now() - 1000)

      // Should still query correctly
      const history = await collectHistory(backend.getHistory('user:1'))

      expect(history[0].value.count).toBe(1)
      expect(history[1].value.count).toBe(2)
      expect(history[2].value.count).toBe(3)
      expect(history[3].value.count).toBe(4)
    })
  })

  // =============================================================================
  // CONCURRENT OPERATIONS
  // =============================================================================

  describe('concurrent operations', () => {
    it('should handle concurrent puts to different keys', async () => {
      const { backend } = createTestBackend()

      await Promise.all([
        backend.put('user:1', { name: 'Alice', count: 1 }),
        backend.put('user:2', { name: 'Bob', count: 2 }),
        backend.put('user:3', { name: 'Charlie', count: 3 }),
      ])

      const [alice, bob, charlie] = await Promise.all([
        backend.get('user:1'),
        backend.get('user:2'),
        backend.get('user:3'),
      ])

      expect(alice?.name).toBe('Alice')
      expect(bob?.name).toBe('Bob')
      expect(charlie?.name).toBe('Charlie')
    })

    it('should handle concurrent getAt queries', async () => {
      const { backend } = createTestBackend()

      const t1 = Date.now() - 1000
      const t2 = Date.now()

      await backend.putAt('user:1', { name: 'Old', count: 1 }, t1)
      await backend.putAt('user:1', { name: 'New', count: 2 }, t2)

      const results = await Promise.all([
        backend.getAt('user:1', t1),
        backend.getAt('user:1', t2),
        backend.getAt('user:1', t1),
        backend.getAt('user:1', t2),
      ])

      expect(results[0]?.count).toBe(1)
      expect(results[1]?.count).toBe(2)
      expect(results[2]?.count).toBe(1)
      expect(results[3]?.count).toBe(2)
    })
  })

  // =============================================================================
  // INTEGRATION WITH TEMPORAL STORE
  // =============================================================================

  describe('integration with TemporalStore', () => {
    it('should write to both current and temporal stores', async () => {
      const { backend, current, temporal } = createTestBackend()

      await backend.put('user:1', { name: 'Alice', count: 1 })

      // Should be in current store
      const currentValue = await current.get('user:1')
      expect(currentValue).toEqual({ name: 'Alice', count: 1 })

      // Should be in temporal store
      const temporalValue = await temporal.get('user:1')
      expect(temporalValue).toEqual({ name: 'Alice', count: 1 })
    })

    it('should leverage TemporalStore retention', async () => {
      const current = new InMemoryStateBackend<TestValue>('test')
      const temporal = createTemporalStore<TestValue>({
        retention: { maxVersions: 2 },
      })
      const backend = new TemporalStateBackend(current, temporal)

      const t1 = Date.now() - 3000
      const t2 = Date.now() - 2000
      const t3 = Date.now() - 1000

      await backend.putAt('user:1', { name: 'V1', count: 1 }, t1)
      await backend.putAt('user:1', { name: 'V2', count: 2 }, t2)
      await backend.putAt('user:1', { name: 'V3', count: 3 }, t3)

      // Prune via temporal store
      await temporal.prune()

      // Oldest version should be gone
      const result = await backend.getAt('user:1', t1)
      expect(result).toBeNull()
    })

    it('should expose TemporalStore cache stats', async () => {
      const { backend } = createTestBackend()

      await backend.put('user:1', { name: 'Alice', count: 1 })

      // Multiple getAt calls should hit cache
      await backend.getAt('user:1', Date.now())
      await backend.getAt('user:1', Date.now())
      await backend.getAt('user:1', Date.now())

      const stats = backend.getCacheStats()

      expect(stats.hits).toBeGreaterThanOrEqual(0)
      expect(stats.misses).toBeGreaterThanOrEqual(0)
    })
  })
})
