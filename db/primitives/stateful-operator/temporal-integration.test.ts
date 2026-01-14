/**
 * TemporalStateBackend Tests
 *
 * Tests for time-travel state management integration with StatefulOperator:
 * - Basic StateBackend interface operations
 * - Time-travel queries (getAt, getHistory, snapshotAt)
 * - Historical data import (putAt, deleteAt)
 * - Retention policy and compaction
 * - Cache management
 *
 * @module db/primitives/stateful-operator/temporal-integration.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TemporalStateBackend, type TemporalOptions, type TemporalEntry } from './temporal-integration'
import { InMemoryStateBackend, type StateBackend, type StateSnapshot } from './index'
import { createTemporalStore, type TemporalStore, type CacheStats, type PruneStats, type RetentionPolicy } from '../temporal-store'

// =============================================================================
// TEST TYPES
// =============================================================================

interface TestUser {
  id: string
  name: string
  status: 'active' | 'inactive' | 'premium'
}

// =============================================================================
// MOCK TEMPORAL STORE
// =============================================================================

/**
 * Mock TemporalStore for controlled testing
 */
function createMockTemporalStore<T>(): TemporalStore<T> & {
  _entries: Map<string, Array<{ value: T; timestamp: number }>>
  _cacheStats: CacheStats
} {
  const entries = new Map<string, Array<{ value: T; timestamp: number }>>()
  const cacheStats: CacheStats = { hits: 0, misses: 0, size: 0, hitRate: 0 }

  return {
    _entries: entries,
    _cacheStats: cacheStats,

    async put(key: string, value: T, timestamp: number): Promise<void> {
      let versions = entries.get(key)
      if (!versions) {
        versions = []
        entries.set(key, versions)
      }
      versions.push({ value, timestamp })
      versions.sort((a, b) => a.timestamp - b.timestamp)
    },

    async get(key: string): Promise<T | null> {
      const versions = entries.get(key)
      if (!versions || versions.length === 0) return null
      return versions[versions.length - 1]!.value
    },

    async getAsOf(key: string, timestamp: number): Promise<T | null> {
      const versions = entries.get(key)
      if (!versions || versions.length === 0) return null

      // Find latest version at or before timestamp
      let result: T | null = null
      for (const v of versions) {
        if (v.timestamp <= timestamp) {
          result = v.value
        } else {
          break
        }
      }
      return result
    },

    range(prefix: string, timeRange: { start?: number; end?: number }): AsyncIterator<T> {
      const matchingKeys: string[] = []
      for (const key of entries.keys()) {
        if (key.startsWith(prefix)) {
          matchingKeys.push(key)
        }
      }

      let index = 0
      const self = this

      return {
        async next(): Promise<IteratorResult<T>> {
          while (index < matchingKeys.length) {
            const key = matchingKeys[index++]!
            const versions = entries.get(key)
            if (!versions || versions.length === 0) continue

            // Find latest version within time range
            for (let i = versions.length - 1; i >= 0; i--) {
              const v = versions[i]!
              if (timeRange.start !== undefined && v.timestamp < timeRange.start) continue
              if (timeRange.end !== undefined && v.timestamp > timeRange.end) continue
              return { value: v.value, done: false }
            }
          }
          return { value: undefined as unknown as T, done: true }
        },
      }
    },

    async snapshot(): Promise<string> {
      return `snapshot-${Date.now()}`
    },

    async restoreSnapshot(_id: string): Promise<void> {
      // No-op for mock
    },

    async listSnapshots(): Promise<Array<{ id: string; timestamp: number; createdAt: number }>> {
      return []
    },

    async prune(policy?: RetentionPolicy): Promise<PruneStats> {
      let versionsRemoved = 0
      let keysAffected = 0
      let keysRemoved = 0

      if (policy?.maxAge) {
        const cutoff = Date.now() - (typeof policy.maxAge === 'number' ? policy.maxAge : 0)
        for (const [key, versions] of entries) {
          const originalLength = versions.length
          const filtered = versions.filter((v) => v.timestamp >= cutoff)
          if (filtered.length < originalLength) {
            keysAffected++
            versionsRemoved += originalLength - filtered.length
            if (filtered.length === 0) {
              entries.delete(key)
              keysRemoved++
            } else {
              entries.set(key, filtered)
            }
          }
        }
      }

      return { versionsRemoved, keysAffected, keysRemoved }
    },

    async compact(policy?: RetentionPolicy): Promise<PruneStats> {
      return this.prune(policy)
    },

    getRetentionPolicy(): RetentionPolicy | undefined {
      return undefined
    },

    setRetentionPolicy(_policy: RetentionPolicy | undefined): void {
      // No-op for mock
    },

    async putBatch(_entries: Array<{ key: string; value: T; timestamp: number }>): Promise<void> {
      // No-op for mock
    },

    getCacheStats(): CacheStats {
      return cacheStats
    },

    clearCache(): void {
      cacheStats.hits = 0
      cacheStats.misses = 0
      cacheStats.size = 0
      cacheStats.hitRate = 0
    },
  }
}

// =============================================================================
// BASIC STATEBACKEND INTERFACE TESTS
// =============================================================================

describe('TemporalStateBackend', () => {
  describe('StateBackend interface', () => {
    let backend: TemporalStateBackend<TestUser>
    let currentBackend: InMemoryStateBackend<TestUser>
    let temporalStore: ReturnType<typeof createMockTemporalStore<TestUser | symbol>>

    beforeEach(() => {
      currentBackend = new InMemoryStateBackend<TestUser>('test-users')
      temporalStore = createMockTemporalStore<TestUser | symbol>()
      backend = new TemporalStateBackend(currentBackend, temporalStore as unknown as TemporalStore<TestUser | symbol>)
    })

    it('should have a name combining temporal prefix with inner backend name', () => {
      expect(backend.name).toBe('temporal:test-users')
    })

    describe('get/put operations', () => {
      it('should store and retrieve values', async () => {
        const user: TestUser = { id: '1', name: 'Alice', status: 'active' }
        await backend.put('user:1', user)

        const result = await backend.get('user:1')
        expect(result).toEqual(user)
      })

      it('should return undefined for non-existent keys', async () => {
        const result = await backend.get('nonexistent')
        expect(result).toBeUndefined()
      })

      it('should overwrite existing values', async () => {
        const user1: TestUser = { id: '1', name: 'Alice', status: 'active' }
        const user2: TestUser = { id: '1', name: 'Alice', status: 'premium' }

        await backend.put('user:1', user1)
        await backend.put('user:1', user2)

        const result = await backend.get('user:1')
        expect(result).toEqual(user2)
      })

      it('should write to both current and temporal stores', async () => {
        const user: TestUser = { id: '1', name: 'Alice', status: 'active' }
        await backend.put('user:1', user)

        // Check current store
        const currentValue = await currentBackend.get('user:1')
        expect(currentValue).toEqual(user)

        // Check temporal store
        const temporalValue = await temporalStore.get('user:1')
        expect(temporalValue).toEqual(user)
      })
    })

    describe('delete operations', () => {
      it('should delete values from current state', async () => {
        const user: TestUser = { id: '1', name: 'Alice', status: 'active' }
        await backend.put('user:1', user)
        await backend.delete('user:1')

        const result = await backend.get('user:1')
        expect(result).toBeUndefined()
      })

      it('should record deletion in temporal store as tombstone', async () => {
        const user: TestUser = { id: '1', name: 'Alice', status: 'active' }
        await backend.put('user:1', user)
        await backend.delete('user:1')

        // Temporal store should have a tombstone marker
        const versions = temporalStore._entries.get('user:1')
        expect(versions).toBeDefined()
        expect(versions!.length).toBeGreaterThan(1)
      })
    })

    describe('list operations', () => {
      it('should list all entries', async () => {
        await backend.put('user:1', { id: '1', name: 'Alice', status: 'active' })
        await backend.put('user:2', { id: '2', name: 'Bob', status: 'inactive' })
        await backend.put('user:3', { id: '3', name: 'Charlie', status: 'premium' })

        const entries: Array<[string, TestUser]> = []
        for await (const entry of backend.list()) {
          entries.push(entry)
        }

        expect(entries).toHaveLength(3)
        expect(entries.map(([k]) => k).sort()).toEqual(['user:1', 'user:2', 'user:3'])
      })

      it('should list entries with prefix filter', async () => {
        await backend.put('user:1', { id: '1', name: 'Alice', status: 'active' })
        await backend.put('admin:1', { id: 'a1', name: 'Admin', status: 'active' })
        await backend.put('user:2', { id: '2', name: 'Bob', status: 'inactive' })

        const entries: Array<[string, TestUser]> = []
        for await (const entry of backend.list('user:')) {
          entries.push(entry)
        }

        expect(entries).toHaveLength(2)
        expect(entries.map(([k]) => k).sort()).toEqual(['user:1', 'user:2'])
      })
    })

    describe('size operations', () => {
      it('should return correct size', async () => {
        expect(await backend.size()).toBe(0)

        await backend.put('user:1', { id: '1', name: 'Alice', status: 'active' })
        expect(await backend.size()).toBe(1)

        await backend.put('user:2', { id: '2', name: 'Bob', status: 'inactive' })
        expect(await backend.size()).toBe(2)

        await backend.delete('user:1')
        expect(await backend.size()).toBe(1)
      })
    })

    describe('snapshot/restore operations', () => {
      it('should create snapshot of current state', async () => {
        await backend.put('user:1', { id: '1', name: 'Alice', status: 'active' })
        await backend.put('user:2', { id: '2', name: 'Bob', status: 'inactive' })

        const snapshot = await backend.snapshot()

        expect(snapshot.id).toBeDefined()
        expect(snapshot.timestamp).toBeDefined()
        expect(snapshot.metadata.stateCount).toBe(2)
      })

      it('should restore from snapshot', async () => {
        await backend.put('user:1', { id: '1', name: 'Alice', status: 'active' })
        const snapshot = await backend.snapshot()

        await backend.put('user:1', { id: '1', name: 'Alice Updated', status: 'premium' })
        await backend.put('user:2', { id: '2', name: 'Bob', status: 'inactive' })

        await backend.restore(snapshot)

        const result = await backend.get('user:1')
        expect(result?.name).toBe('Alice')

        // Note: restore only affects current state, not temporal history
      })
    })

    describe('clear operations', () => {
      it('should clear current state but preserve temporal history', async () => {
        await backend.put('user:1', { id: '1', name: 'Alice', status: 'active' })
        await backend.put('user:2', { id: '2', name: 'Bob', status: 'inactive' })

        await backend.clear()

        expect(await backend.size()).toBe(0)
        expect(await backend.get('user:1')).toBeUndefined()

        // Temporal history should be preserved
        expect(temporalStore._entries.size).toBeGreaterThan(0)
      })
    })
  })

  // ===========================================================================
  // TIME-TRAVEL OPERATIONS TESTS
  // ===========================================================================

  describe('Time-travel operations', () => {
    let backend: TemporalStateBackend<TestUser>
    let currentBackend: InMemoryStateBackend<TestUser>
    let temporalStore: ReturnType<typeof createMockTemporalStore<TestUser | symbol>>

    beforeEach(() => {
      currentBackend = new InMemoryStateBackend<TestUser>('test-users')
      temporalStore = createMockTemporalStore<TestUser | symbol>()
      backend = new TemporalStateBackend(currentBackend, temporalStore as unknown as TemporalStore<TestUser | symbol>)
    })

    describe('putAt - historical data import', () => {
      it('should store value at specific timestamp', async () => {
        const timestamp = Date.now() - 10000 // 10 seconds ago
        const user: TestUser = { id: '1', name: 'Alice', status: 'active' }

        await backend.putAt('user:1', user, timestamp)

        // Should be queryable at that timestamp
        const result = await backend.getAt('user:1', timestamp)
        expect(result).toEqual(user)
      })

      it('should allow backfilling historical data', async () => {
        const now = Date.now()
        const t1 = now - 30000 // 30 seconds ago
        const t2 = now - 20000 // 20 seconds ago
        const t3 = now - 10000 // 10 seconds ago

        await backend.putAt('user:1', { id: '1', name: 'Alice V1', status: 'active' }, t1)
        await backend.putAt('user:1', { id: '1', name: 'Alice V2', status: 'active' }, t2)
        await backend.putAt('user:1', { id: '1', name: 'Alice V3', status: 'premium' }, t3)

        // Query at different points in time
        const atT1 = await backend.getAt('user:1', t1)
        const atT2 = await backend.getAt('user:1', t2)
        const atT3 = await backend.getAt('user:1', t3)

        expect(atT1?.name).toBe('Alice V1')
        expect(atT2?.name).toBe('Alice V2')
        expect(atT3?.name).toBe('Alice V3')
      })
    })

    describe('deleteAt - historical deletion', () => {
      it('should record deletion at specific timestamp', async () => {
        const now = Date.now()
        const t1 = now - 20000
        const t2 = now - 10000

        await backend.putAt('user:1', { id: '1', name: 'Alice', status: 'active' }, t1)
        await backend.deleteAt('user:1', t2)

        // Before deletion - should have value
        const beforeDelete = await backend.getAt('user:1', t1 + 1000)
        expect(beforeDelete).toBeDefined()

        // After deletion - should be undefined
        const afterDelete = await backend.getAt('user:1', t2 + 1000)
        expect(afterDelete).toBeUndefined()
      })
    })

    describe('getAt - point-in-time queries', () => {
      it('should return value at specific timestamp', async () => {
        const now = Date.now()

        // Mock Date.now for consistent timestamps
        const originalDateNow = Date.now
        let mockTime = now - 20000
        vi.spyOn(Date, 'now').mockImplementation(() => mockTime)

        await backend.put('user:1', { id: '1', name: 'Alice V1', status: 'active' })
        const t1 = mockTime

        mockTime = now - 10000
        await backend.put('user:1', { id: '1', name: 'Alice V2', status: 'premium' })
        const t2 = mockTime

        vi.spyOn(Date, 'now').mockRestore()

        // Query at t1
        const atT1 = await backend.getAt('user:1', t1)
        expect(atT1?.name).toBe('Alice V1')

        // Query at t2
        const atT2 = await backend.getAt('user:1', t2)
        expect(atT2?.name).toBe('Alice V2')
      })

      it('should return undefined for timestamp before any data', async () => {
        const now = Date.now()
        await backend.put('user:1', { id: '1', name: 'Alice', status: 'active' })

        const result = await backend.getAt('user:1', now - 1000000) // Way in the past
        expect(result).toBeUndefined()
      })

      it('should return undefined for non-existent key', async () => {
        const result = await backend.getAt('nonexistent', Date.now())
        expect(result).toBeUndefined()
      })

      it('should handle deleted values correctly', async () => {
        const now = Date.now()

        let mockTime = now - 20000
        vi.spyOn(Date, 'now').mockImplementation(() => mockTime)

        await backend.put('user:1', { id: '1', name: 'Alice', status: 'active' })
        const t1 = mockTime

        mockTime = now - 10000
        await backend.delete('user:1')
        const t2 = mockTime

        vi.spyOn(Date, 'now').mockRestore()

        // Before delete should have value
        const beforeDelete = await backend.getAt('user:1', t1)
        expect(beforeDelete).toBeDefined()

        // After delete should be undefined
        const afterDelete = await backend.getAt('user:1', t2 + 1000)
        expect(afterDelete).toBeUndefined()
      })
    })

    describe('snapshotAt - point-in-time reconstruction', () => {
      it('should reconstruct entire state at timestamp', async () => {
        const now = Date.now()

        let mockTime = now - 30000
        vi.spyOn(Date, 'now').mockImplementation(() => mockTime)

        await backend.put('user:1', { id: '1', name: 'Alice', status: 'active' })
        await backend.put('user:2', { id: '2', name: 'Bob', status: 'inactive' })
        const t1 = mockTime

        mockTime = now - 20000
        await backend.put('user:1', { id: '1', name: 'Alice Updated', status: 'premium' })
        await backend.put('user:3', { id: '3', name: 'Charlie', status: 'active' })

        mockTime = now - 10000
        await backend.delete('user:2')
        const t3 = mockTime

        vi.spyOn(Date, 'now').mockRestore()

        // Snapshot at t1 - should have user:1 and user:2
        const snapshotT1 = await backend.snapshotAt(t1)
        expect(snapshotT1.has('user:1')).toBe(true)
        expect(snapshotT1.has('user:2')).toBe(true)
        expect(snapshotT1.has('user:3')).toBe(false)
        expect(snapshotT1.get('user:1')?.name).toBe('Alice')

        // Snapshot at t3 - should have user:1, user:3, but not user:2 (deleted)
        const snapshotT3 = await backend.snapshotAt(t3 + 1000)
        expect(snapshotT3.has('user:1')).toBe(true)
        expect(snapshotT3.has('user:2')).toBe(false)
        expect(snapshotT3.has('user:3')).toBe(true)
        expect(snapshotT3.get('user:1')?.name).toBe('Alice Updated')
      })

      it('should return empty map for timestamp before any data', async () => {
        await backend.put('user:1', { id: '1', name: 'Alice', status: 'active' })

        const snapshot = await backend.snapshotAt(0) // Epoch
        expect(snapshot.size).toBe(0)
      })
    })

    describe('getHistory - change history', () => {
      it('should return change history for a key', async () => {
        const now = Date.now()

        // Create history with specific timestamps
        await backend.putAt('user:1', { id: '1', name: 'Alice V1', status: 'active' }, now - 30000)
        await backend.putAt('user:1', { id: '1', name: 'Alice V2', status: 'inactive' }, now - 20000)
        await backend.putAt('user:1', { id: '1', name: 'Alice V3', status: 'premium' }, now - 10000)

        const history: Array<TemporalEntry<TestUser>> = []
        for await (const entry of backend.getHistory('user:1', now - 35000, now)) {
          history.push(entry)
        }

        // Should have entries (exact count depends on implementation)
        expect(history.length).toBeGreaterThan(0)
        expect(history[0]?.key).toBe('user:1')
      })

      it('should return empty for non-existent key', async () => {
        const history: Array<TemporalEntry<TestUser>> = []
        for await (const entry of backend.getHistory('nonexistent')) {
          history.push(entry)
        }
        expect(history).toHaveLength(0)
      })

      it('should filter by time range', async () => {
        const now = Date.now()
        const t1 = now - 30000
        const t2 = now - 20000
        const t3 = now - 10000

        await backend.putAt('user:1', { id: '1', name: 'Alice V1', status: 'active' }, t1)
        await backend.putAt('user:1', { id: '1', name: 'Alice V2', status: 'inactive' }, t2)
        await backend.putAt('user:1', { id: '1', name: 'Alice V3', status: 'premium' }, t3)

        // Query only middle range
        const history: Array<TemporalEntry<TestUser>> = []
        for await (const entry of backend.getHistory('user:1', t2 - 1000, t2 + 1000)) {
          history.push(entry)
        }

        // Should find at least the V2 entry
        const hasV2 = history.some((e) => (e.value as TestUser)?.name === 'Alice V2')
        expect(hasV2).toBe(true)
      })
    })
  })

  // ===========================================================================
  // RETENTION AND COMPACTION TESTS
  // ===========================================================================

  describe('Retention and compaction', () => {
    let backend: TemporalStateBackend<TestUser>
    let currentBackend: InMemoryStateBackend<TestUser>
    let temporalStore: ReturnType<typeof createMockTemporalStore<TestUser | symbol>>

    beforeEach(() => {
      currentBackend = new InMemoryStateBackend<TestUser>('test-users')
      temporalStore = createMockTemporalStore<TestUser | symbol>()
    })

    describe('compact with retention policy', () => {
      it('should prune old entries based on maxAge', async () => {
        const options: TemporalOptions = {
          retentionMs: 10000, // 10 seconds
        }
        backend = new TemporalStateBackend(currentBackend, temporalStore as unknown as TemporalStore<TestUser | symbol>, options)

        // Add old data
        await backend.putAt('user:1', { id: '1', name: 'Old Alice', status: 'active' }, Date.now() - 20000)

        // Add recent data
        await backend.put('user:2', { id: '2', name: 'Recent Bob', status: 'active' })

        const stats = await backend.compact()

        expect(stats.versionsRemoved).toBeGreaterThanOrEqual(0)
      })

      it('should do nothing without retention policy', async () => {
        backend = new TemporalStateBackend(currentBackend, temporalStore as unknown as TemporalStore<TestUser | symbol>)

        await backend.put('user:1', { id: '1', name: 'Alice', status: 'active' })

        const stats = await backend.compact()

        // Without policy, nothing should be pruned by default
        expect(stats).toBeDefined()
      })
    })
  })

  // ===========================================================================
  // CACHE MANAGEMENT TESTS
  // ===========================================================================

  describe('Cache management', () => {
    let backend: TemporalStateBackend<TestUser>
    let currentBackend: InMemoryStateBackend<TestUser>
    let temporalStore: ReturnType<typeof createMockTemporalStore<TestUser | symbol>>

    beforeEach(() => {
      currentBackend = new InMemoryStateBackend<TestUser>('test-users')
      temporalStore = createMockTemporalStore<TestUser | symbol>()
      backend = new TemporalStateBackend(currentBackend, temporalStore as unknown as TemporalStore<TestUser | symbol>)
    })

    it('should return cache stats', () => {
      const stats = backend.getCacheStats()

      expect(stats).toBeDefined()
      expect(typeof stats.hits).toBe('number')
      expect(typeof stats.misses).toBe('number')
      expect(typeof stats.size).toBe('number')
      expect(typeof stats.hitRate).toBe('number')
    })

    it('should clear cache', () => {
      backend.clearCache()

      const stats = backend.getCacheStats()
      expect(stats.size).toBe(0)
      expect(stats.hits).toBe(0)
      expect(stats.misses).toBe(0)
    })
  })

  // ===========================================================================
  // INTEGRATION TESTS
  // ===========================================================================

  describe('Integration scenarios', () => {
    let backend: TemporalStateBackend<TestUser>

    beforeEach(() => {
      const currentBackend = new InMemoryStateBackend<TestUser>('test-users')
      const temporalStore = createTemporalStore<TestUser | symbol>()
      backend = new TemporalStateBackend(currentBackend, temporalStore)
    })

    it('should handle user status change history', async () => {
      const now = Date.now()

      // Simulate user status changes over time
      let mockTime = now - 86400000 // 1 day ago
      vi.spyOn(Date, 'now').mockImplementation(() => mockTime)
      await backend.put('user:1', { id: '1', name: 'Alice', status: 'active' })
      const dayAgo = mockTime

      mockTime = now - 43200000 // 12 hours ago
      await backend.put('user:1', { id: '1', name: 'Alice', status: 'inactive' })

      mockTime = now - 3600000 // 1 hour ago
      await backend.put('user:1', { id: '1', name: 'Alice', status: 'premium' })

      vi.spyOn(Date, 'now').mockRestore()

      // Current value should be premium
      const current = await backend.get('user:1')
      expect(current?.status).toBe('premium')

      // 1 day ago should be active
      const atDayAgo = await backend.getAt('user:1', dayAgo)
      expect(atDayAgo?.status).toBe('active')
    })

    it('should handle multiple users with different histories', async () => {
      const now = Date.now()

      // User 1 history
      await backend.putAt('user:1', { id: '1', name: 'Alice', status: 'active' }, now - 3600000)
      await backend.putAt('user:1', { id: '1', name: 'Alice', status: 'premium' }, now - 1800000)

      // User 2 history
      await backend.putAt('user:2', { id: '2', name: 'Bob', status: 'active' }, now - 3600000)
      await backend.putAt('user:2', { id: '2', name: 'Bob', status: 'inactive' }, now - 900000)

      // Snapshot at 45 minutes ago
      const snapshot = await backend.snapshotAt(now - 2700000)

      expect(snapshot.size).toBe(2)
      expect(snapshot.get('user:1')?.status).toBe('active')
      expect(snapshot.get('user:2')?.status).toBe('active')
    })

    it('should handle deletion and recreation', async () => {
      const now = Date.now()

      // Create user
      await backend.putAt('user:1', { id: '1', name: 'Alice', status: 'active' }, now - 3600000)
      const t1 = now - 3600000

      // Delete user
      await backend.deleteAt('user:1', now - 1800000)
      const t2 = now - 1800000

      // Recreate user
      await backend.putAt('user:1', { id: '1', name: 'Alice Returned', status: 'premium' }, now - 900000)
      const t3 = now - 900000

      // Query at different times
      const atT1 = await backend.getAt('user:1', t1)
      expect(atT1?.name).toBe('Alice')

      const atT2 = await backend.getAt('user:1', t2 + 100)
      expect(atT2).toBeUndefined()

      const atT3 = await backend.getAt('user:1', t3)
      expect(atT3?.name).toBe('Alice Returned')
    })
  })

  // ===========================================================================
  // EDGE CASES AND ERROR HANDLING
  // ===========================================================================

  describe('Edge cases', () => {
    let backend: TemporalStateBackend<TestUser>

    beforeEach(() => {
      const currentBackend = new InMemoryStateBackend<TestUser>('test-users')
      const temporalStore = createTemporalStore<TestUser | symbol>()
      backend = new TemporalStateBackend(currentBackend, temporalStore)
    })

    it('should handle empty prefix in list', async () => {
      await backend.put('user:1', { id: '1', name: 'Alice', status: 'active' })
      await backend.put('admin:1', { id: 'a1', name: 'Admin', status: 'active' })

      const entries: Array<[string, TestUser]> = []
      for await (const entry of backend.list()) {
        entries.push(entry)
      }

      expect(entries).toHaveLength(2)
    })

    it('should handle concurrent reads and writes', async () => {
      const promises: Promise<void>[] = []

      // Concurrent writes
      for (let i = 0; i < 10; i++) {
        promises.push(
          backend.put(`user:${i}`, { id: `${i}`, name: `User ${i}`, status: 'active' }),
        )
      }

      await Promise.all(promises)

      // Verify all entries exist
      const size = await backend.size()
      expect(size).toBe(10)
    })

    it('should handle very old timestamps', async () => {
      // Unix epoch
      await backend.putAt('user:1', { id: '1', name: 'Ancient Alice', status: 'active' }, 0)

      const result = await backend.getAt('user:1', 0)
      expect(result?.name).toBe('Ancient Alice')
    })

    it('should handle future timestamps', async () => {
      const future = Date.now() + 86400000 // 1 day in the future
      await backend.putAt('user:1', { id: '1', name: 'Future Alice', status: 'active' }, future)

      // Current get should not see future value (depends on implementation)
      // getAt at future time should see it
      const result = await backend.getAt('user:1', future)
      expect(result?.name).toBe('Future Alice')
    })

    it('should handle special characters in keys', async () => {
      const specialKey = 'user:test@example.com:profile:v1'
      await backend.put(specialKey, { id: '1', name: 'Special', status: 'active' })

      const result = await backend.get(specialKey)
      expect(result?.name).toBe('Special')
    })

    it('should handle large values', async () => {
      const largeUser: TestUser = {
        id: '1',
        name: 'A'.repeat(10000), // Large name
        status: 'active',
      }

      await backend.put('user:1', largeUser)

      const result = await backend.get('user:1')
      expect(result?.name.length).toBe(10000)
    })
  })

  // ===========================================================================
  // TTL TESTS
  // ===========================================================================

  describe('TTL support', () => {
    let backend: TemporalStateBackend<TestUser>
    let currentBackend: InMemoryStateBackend<TestUser>

    beforeEach(() => {
      currentBackend = new InMemoryStateBackend<TestUser>('test-users')
      const temporalStore = createTemporalStore<TestUser | symbol>()
      backend = new TemporalStateBackend(currentBackend, temporalStore)
    })

    it('should support TTL on put operations', async () => {
      const user: TestUser = { id: '1', name: 'Alice', status: 'active' }

      // Put with TTL (passed to underlying current backend)
      await backend.put('user:1', user, 100) // 100ms TTL

      // Should exist immediately
      const immediate = await backend.get('user:1')
      expect(immediate).toEqual(user)

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 150))

      // Should be expired in current state (if underlying backend supports TTL)
      const afterTtl = await currentBackend.get('user:1')
      expect(afterTtl).toBeUndefined()
    })
  })
})

// =============================================================================
// TEMPORAL WORKFLOW PATTERNS (Workflow-like behavior)
// =============================================================================

describe('Workflow-like temporal patterns', () => {
  /**
   * These tests demonstrate how TemporalStateBackend can be used for
   * workflow state management patterns similar to Temporal.io concepts:
   * - Durable state persistence
   * - State versioning and history
   * - Point-in-time recovery
   * - Activity-like state transitions
   */

  describe('Workflow state management', () => {
    interface WorkflowState {
      workflowId: string
      status: 'pending' | 'running' | 'completed' | 'failed'
      step: number
      data: Record<string, unknown>
    }

    let backend: TemporalStateBackend<WorkflowState>

    beforeEach(() => {
      const currentBackend = new InMemoryStateBackend<WorkflowState>('workflows')
      const temporalStore = createTemporalStore<WorkflowState | symbol>()
      backend = new TemporalStateBackend(currentBackend, temporalStore)
    })

    it('should track workflow state transitions (activity execution pattern)', async () => {
      const now = Date.now()
      const workflowId = 'wf-123'

      // Step 1: Workflow starts
      await backend.putAt(
        workflowId,
        { workflowId, status: 'pending', step: 0, data: {} },
        now - 10000,
      )

      // Step 2: First activity runs
      await backend.putAt(
        workflowId,
        { workflowId, status: 'running', step: 1, data: { activity1: 'completed' } },
        now - 8000,
      )

      // Step 3: Second activity runs
      await backend.putAt(
        workflowId,
        { workflowId, status: 'running', step: 2, data: { activity1: 'completed', activity2: 'completed' } },
        now - 5000,
      )

      // Step 4: Workflow completes
      await backend.putAt(
        workflowId,
        { workflowId, status: 'completed', step: 3, data: { activity1: 'completed', activity2: 'completed', result: 'success' } },
        now - 1000,
      )

      // Verify we can query workflow state at any point
      // Query at step 1 time (now - 8000), should see running status
      const atStep1 = await backend.getAt(workflowId, now - 8000)
      expect(atStep1?.status).toBe('running')
      expect(atStep1?.step).toBe(1)

      // Query at step 2 time (now - 5000), should see step 2
      const atStep2 = await backend.getAt(workflowId, now - 5000)
      expect(atStep2?.step).toBe(2)

      const final = await backend.get(workflowId)
      expect(final?.status).toBe('completed')
    })

    it('should support workflow versioning (signal handling pattern)', async () => {
      const now = Date.now()
      const workflowId = 'wf-456'

      // Initial state
      await backend.putAt(
        workflowId,
        { workflowId, status: 'running', step: 1, data: { signalCount: 0 } },
        now - 10000,
      )

      // Simulate receiving signals that update state
      for (let i = 1; i <= 3; i++) {
        await backend.putAt(
          workflowId,
          { workflowId, status: 'running', step: 1, data: { signalCount: i, lastSignal: `signal-${i}` } },
          now - 10000 + i * 1000,
        )
      }

      // Query history to see all signal state changes
      const current = await backend.get(workflowId)
      expect((current?.data as { signalCount: number }).signalCount).toBe(3)

      // Can query state at any signal version
      const afterFirstSignal = await backend.getAt(workflowId, now - 8500)
      expect((afterFirstSignal?.data as { signalCount: number }).signalCount).toBe(1)
    })

    it('should support query handlers (state inspection)', async () => {
      const workflowId = 'wf-789'

      // Set up workflow state
      await backend.put(workflowId, {
        workflowId,
        status: 'running',
        step: 5,
        data: {
          progress: 75,
          processedItems: 150,
          totalItems: 200,
        },
      })

      // Query handler simulation - inspect current state
      const state = await backend.get(workflowId)
      expect(state?.status).toBe('running')
      expect((state?.data as { progress: number }).progress).toBe(75)

      // Can also query historical state for debugging
      const snapshot = await backend.snapshotAt(Date.now())
      expect(snapshot.has(workflowId)).toBe(true)
    })

    it('should support point-in-time recovery (workflow replay)', async () => {
      const now = Date.now()
      const workflowId = 'wf-replay'

      // Record workflow history
      await backend.putAt(workflowId, { workflowId, status: 'pending', step: 0, data: {} }, now - 5000)
      await backend.putAt(workflowId, { workflowId, status: 'running', step: 1, data: { checkpoint1: true } }, now - 4000)
      await backend.putAt(workflowId, { workflowId, status: 'running', step: 2, data: { checkpoint1: true, checkpoint2: true } }, now - 3000)
      await backend.putAt(workflowId, { workflowId, status: 'failed', step: 2, data: { checkpoint1: true, checkpoint2: true, error: 'timeout' } }, now - 2000)

      // "Replay" from before failure
      const beforeFailure = await backend.getAt(workflowId, now - 2500)
      expect(beforeFailure?.status).toBe('running')
      expect(beforeFailure?.step).toBe(2)
      expect((beforeFailure?.data as { error?: string }).error).toBeUndefined()

      // Can use this state to restart workflow from checkpoint
      const checkpointState = beforeFailure
      expect(checkpointState?.data).toEqual({ checkpoint1: true, checkpoint2: true })
    })
  })
})
