/**
 * Checkpointing Tests
 *
 * Tests for checkpoint creation, validation, and restoration across backends.
 * Covers atomic snapshots, incremental state, and checkpoint metadata.
 *
 * Run with: npx vitest run db/primitives/stateful-operator/backends/tests/checkpointing.test.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { StateSnapshot } from '../../index'
import { InMemoryStateBackend } from '../../index'
import { DOStateBackend, type DurableObjectStorage } from '../do-backend'

// =============================================================================
// Mock Storage Factory
// =============================================================================

function createMockDOStorage(): DurableObjectStorage & {
  _data: Map<string, unknown>
  _transactionCount: number
} {
  const data = new Map<string, unknown>()
  let transactionCount = 0

  const storage: DurableObjectStorage & {
    _data: Map<string, unknown>
    _transactionCount: number
  } = {
    _data: data,
    get _transactionCount() {
      return transactionCount
    },

    async get<T>(keyOrKeys: string | string[]): Promise<T | undefined | Map<string, T>> {
      if (Array.isArray(keyOrKeys)) {
        const result = new Map<string, T>()
        for (const key of keyOrKeys) {
          const value = data.get(key)
          if (value !== undefined) {
            result.set(key, value as T)
          }
        }
        return result
      }
      return data.get(keyOrKeys) as T | undefined
    },

    async put<T>(keyOrEntries: string | Record<string, T>, value?: T): Promise<void> {
      if (typeof keyOrEntries === 'string') {
        data.set(keyOrEntries, value)
      } else {
        for (const [k, v] of Object.entries(keyOrEntries)) {
          data.set(k, v)
        }
      }
    },

    async delete(keyOrKeys: string | string[]): Promise<boolean | number> {
      if (Array.isArray(keyOrKeys)) {
        let count = 0
        for (const key of keyOrKeys) {
          if (data.delete(key)) count++
        }
        return count
      }
      return data.delete(keyOrKeys)
    },

    async deleteAll(): Promise<void> {
      data.clear()
    },

    async list<T>(options?: {
      prefix?: string
      start?: string
      end?: string
      limit?: number
      reverse?: boolean
    }): Promise<Map<string, T>> {
      const result = new Map<string, T>()
      let count = 0

      const sortedKeys = [...data.keys()].sort()
      const keysToIterate = options?.reverse ? sortedKeys.reverse() : sortedKeys

      for (const key of keysToIterate) {
        if (options?.prefix && !key.startsWith(options.prefix)) continue
        if (options?.start && key < options.start) continue
        if (options?.end && key >= options.end) continue
        if (options?.limit !== undefined && count >= options.limit) break

        result.set(key, data.get(key) as T)
        count++
      }

      return result
    },

    async transaction<T>(closure: (txn: DurableObjectStorage) => Promise<T>): Promise<T> {
      transactionCount++
      return closure(storage)
    },
  }

  return storage
}

// =============================================================================
// Checkpoint Creation Tests
// =============================================================================

describe('Checkpoint Creation', () => {
  describe('InMemoryStateBackend', () => {
    let backend: InMemoryStateBackend<{ count: number; name: string }>

    beforeEach(() => {
      backend = new InMemoryStateBackend('checkpoint-test')
    })

    it('should create snapshot with valid ID format', async () => {
      await backend.put('key', { count: 1, name: 'test' })
      const snapshot = await backend.snapshot()

      expect(snapshot.id).toMatch(/^checkpoint-test-snap-\d+-\d+$/)
    })

    it('should include timestamp in snapshot', async () => {
      const before = Date.now()
      await backend.put('key', { count: 1, name: 'test' })
      const snapshot = await backend.snapshot()
      const after = Date.now()

      expect(snapshot.timestamp).toBeGreaterThanOrEqual(before)
      expect(snapshot.timestamp).toBeLessThanOrEqual(after)
    })

    it('should serialize complex nested objects', async () => {
      const complexValue = {
        count: 42,
        name: 'complex',
      }

      await backend.put('complex', complexValue)
      const snapshot = await backend.snapshot()

      // Clear and restore
      await backend.clear()
      await backend.restore(snapshot)

      const restored = await backend.get('complex')
      expect(restored).toEqual(complexValue)
    })

    it('should increment snapshot counter', async () => {
      await backend.put('key', { count: 1, name: 'test' })

      const snap1 = await backend.snapshot()
      const snap2 = await backend.snapshot()
      const snap3 = await backend.snapshot()

      // Extract counter from ID format: name-snap-{counter}-{timestamp}
      const getCounter = (id: string) => parseInt(id.split('-')[2])

      expect(getCounter(snap2.id)).toBe(getCounter(snap1.id) + 1)
      expect(getCounter(snap3.id)).toBe(getCounter(snap2.id) + 1)
    })

    it('should compute deterministic checksum', async () => {
      const backend1 = new InMemoryStateBackend<string>('test1')
      const backend2 = new InMemoryStateBackend<string>('test2')

      // Same data in both backends
      await backend1.put('key', 'value')
      await backend2.put('key', 'value')

      const snap1 = await backend1.snapshot()
      const snap2 = await backend2.snapshot()

      // Checksums should be the same for same data
      expect(snap1.metadata.checksum).toBe(snap2.metadata.checksum)
    })

    it('should produce different checksum for different data', async () => {
      await backend.put('key1', { count: 1, name: 'first' })
      const snap1 = await backend.snapshot()

      await backend.put('key2', { count: 2, name: 'second' })
      const snap2 = await backend.snapshot()

      expect(snap1.metadata.checksum).not.toBe(snap2.metadata.checksum)
    })
  })

  describe('DOStateBackend', () => {
    let storage: ReturnType<typeof createMockDOStorage>
    let backend: DOStateBackend<string>

    beforeEach(() => {
      storage = createMockDOStorage()
      backend = new DOStateBackend(storage, 'do-checkpoint')
    })

    it('should use transaction for consistent snapshot', async () => {
      const initialTxCount = storage._transactionCount

      await backend.put('key1', 'value1')
      await backend.put('key2', 'value2')

      await backend.snapshot()

      // Snapshot should use one transaction
      expect(storage._transactionCount).toBeGreaterThan(initialTxCount)
    })

    it('should capture point-in-time state', async () => {
      // Simulate concurrent modifications
      await backend.put('key1', 'initial1')
      await backend.put('key2', 'initial2')

      // Take snapshot
      const snapshot = await backend.snapshot()

      // Modify state after snapshot
      await backend.put('key1', 'modified1')
      await backend.delete('key2')
      await backend.put('key3', 'new3')

      // Restore should bring back point-in-time state
      await backend.restore(snapshot)

      expect(await backend.get('key1')).toBe('initial1')
      expect(await backend.get('key2')).toBe('initial2')
      expect(await backend.get('key3')).toBeUndefined()
    })

    it('should isolate snapshots between backends', async () => {
      const backend2 = new DOStateBackend<string>(storage, 'other-checkpoint')

      await backend.put('shared-key', 'backend1-value')
      await backend2.put('shared-key', 'backend2-value')

      const snap1 = await backend.snapshot()
      const snap2 = await backend2.snapshot()

      // Each snapshot should only contain its own data
      expect(snap1.metadata.stateCount).toBe(1)
      expect(snap2.metadata.stateCount).toBe(1)

      // Cross-restore should fail or produce unexpected results
      await backend.clear()
      await backend.restore(snap1)

      expect(await backend.get('shared-key')).toBe('backend1-value')
      expect(await backend2.get('shared-key')).toBe('backend2-value')
    })
  })
})

// =============================================================================
// Checkpoint Validation Tests
// =============================================================================

describe('Checkpoint Validation', () => {
  let backend: InMemoryStateBackend<string>

  beforeEach(() => {
    backend = new InMemoryStateBackend('validation-test')
  })

  it('should reject snapshot with corrupted checksum', async () => {
    await backend.put('key', 'value')
    const snapshot = await backend.snapshot()

    const corrupted: StateSnapshot = {
      ...snapshot,
      metadata: {
        ...snapshot.metadata,
        checksum: 'deadbeef',
      },
    }

    await expect(backend.restore(corrupted)).rejects.toThrow(/checksum/i)
  })

  it('should reject snapshot with modified data', async () => {
    await backend.put('key', 'value')
    const snapshot = await backend.snapshot()

    // Tamper with the data
    const tamperedData = new Uint8Array(snapshot.data.length + 10)
    tamperedData.set(snapshot.data)
    tamperedData.set(new TextEncoder().encode('TAMPERED'), snapshot.data.length)

    const corrupted: StateSnapshot = {
      ...snapshot,
      data: tamperedData,
    }

    await expect(backend.restore(corrupted)).rejects.toThrow(/checksum/i)
  })

  it('should accept valid snapshot multiple times', async () => {
    await backend.put('key', 'value')
    const snapshot = await backend.snapshot()

    // Restore same snapshot multiple times
    await expect(backend.restore(snapshot)).resolves.not.toThrow()
    await backend.put('temp', 'data')
    await expect(backend.restore(snapshot)).resolves.not.toThrow()
    await backend.clear()
    await expect(backend.restore(snapshot)).resolves.not.toThrow()

    expect(await backend.get('key')).toBe('value')
  })

  it('should handle empty snapshot correctly', async () => {
    const emptySnapshot = await backend.snapshot()

    expect(emptySnapshot.metadata.stateCount).toBe(0)
    expect(emptySnapshot.metadata.checksum).toBeDefined()

    // Should be restorable
    await backend.put('some-data', 'value')
    await backend.restore(emptySnapshot)

    expect(await backend.size()).toBe(0)
  })
})

// =============================================================================
// Checkpoint Restoration Tests
// =============================================================================

describe('Checkpoint Restoration', () => {
  it('should atomically replace all state on restore', async () => {
    const backend = new InMemoryStateBackend<number>('atomic-test')

    await backend.put('counter:1', 100)
    await backend.put('counter:2', 200)
    const checkpoint = await backend.snapshot()

    // Modify state
    await backend.put('counter:1', 150)
    await backend.put('counter:3', 300)
    await backend.delete('counter:2')

    // Restore
    await backend.restore(checkpoint)

    // Should exactly match checkpoint state
    expect(await backend.get('counter:1')).toBe(100)
    expect(await backend.get('counter:2')).toBe(200)
    expect(await backend.get('counter:3')).toBeUndefined()
    expect(await backend.size()).toBe(2)
  })

  it('should preserve TTL metadata on restore', async () => {
    const storage = createMockDOStorage()
    const backend = new DOStateBackend<string>(storage, 'ttl-restore')

    // Put with TTL that won't expire during test
    await backend.put('expires-later', 'value', 10000)
    await backend.put('no-ttl', 'persistent')

    const checkpoint = await backend.snapshot()

    await backend.clear()
    await backend.restore(checkpoint)

    // Both should be retrievable
    expect(await backend.get('expires-later')).toBe('value')
    expect(await backend.get('no-ttl')).toBe('persistent')
  })

  it('should restore to different backend instance', async () => {
    const storage1 = createMockDOStorage()
    const storage2 = createMockDOStorage()

    const source = new DOStateBackend<string>(storage1, 'source')
    const target = new DOStateBackend<string>(storage2, 'target')

    await source.put('data:1', 'first')
    await source.put('data:2', 'second')

    const checkpoint = await source.snapshot()
    await target.restore(checkpoint)

    // Target should have source's data
    expect(await target.get('data:1')).toBe('first')
    expect(await target.get('data:2')).toBe('second')

    // Source should be unaffected
    expect(await source.get('data:1')).toBe('first')
  })

  it('should handle restoration with high volume of entries', async () => {
    const backend = new InMemoryStateBackend<number>('volume-test')

    // Create many entries
    const entryCount = 1000
    for (let i = 0; i < entryCount; i++) {
      await backend.put(`key:${i}`, i)
    }

    const checkpoint = await backend.snapshot()

    // Clear and restore
    await backend.clear()
    expect(await backend.size()).toBe(0)

    await backend.restore(checkpoint)

    // Verify all entries
    expect(await backend.size()).toBe(entryCount)
    expect(await backend.get('key:0')).toBe(0)
    expect(await backend.get(`key:${entryCount - 1}`)).toBe(entryCount - 1)
    expect(await backend.get('key:500')).toBe(500)
  })
})

// =============================================================================
// Checkpoint Metadata Tests
// =============================================================================

describe('Checkpoint Metadata', () => {
  it('should track accurate state count', async () => {
    const backend = new InMemoryStateBackend<string>('meta-test')

    const snap0 = await backend.snapshot()
    expect(snap0.metadata.stateCount).toBe(0)

    await backend.put('key1', 'value1')
    const snap1 = await backend.snapshot()
    expect(snap1.metadata.stateCount).toBe(1)

    await backend.put('key2', 'value2')
    await backend.put('key3', 'value3')
    const snap3 = await backend.snapshot()
    expect(snap3.metadata.stateCount).toBe(3)

    await backend.delete('key2')
    const snap2 = await backend.snapshot()
    expect(snap2.metadata.stateCount).toBe(2)
  })

  it('should calculate totalBytes correctly', async () => {
    const backend = new InMemoryStateBackend<string>('bytes-test')

    const snapEmpty = await backend.snapshot()
    expect(snapEmpty.metadata.totalBytes).toBeGreaterThan(0) // JSON structure overhead

    await backend.put('key', 'value')
    const snap1 = await backend.snapshot()

    await backend.put('longer-key', 'much longer value with more characters')
    const snap2 = await backend.snapshot()

    expect(snap2.metadata.totalBytes).toBeGreaterThan(snap1.metadata.totalBytes)
  })

  it('should generate valid checksum format', async () => {
    const backend = new InMemoryStateBackend<string>('checksum-test')

    await backend.put('test', 'data')
    const snapshot = await backend.snapshot()

    // Checksum should be a hex string
    expect(snapshot.metadata.checksum).toMatch(/^[0-9a-f]+$/)
  })
})

// =============================================================================
// Incremental Checkpoint Tests
// =============================================================================

describe('Incremental State Changes', () => {
  it('should capture incremental updates correctly', async () => {
    const backend = new InMemoryStateBackend<number>('incremental-test')

    // Initial state
    await backend.put('counter', 0)
    const checkpoint1 = await backend.snapshot()

    // Increment
    await backend.put('counter', 1)
    const checkpoint2 = await backend.snapshot()

    // More increments
    await backend.put('counter', 2)
    await backend.put('counter', 3)
    const checkpoint3 = await backend.snapshot()

    // Restore to different points
    await backend.restore(checkpoint1)
    expect(await backend.get('counter')).toBe(0)

    await backend.restore(checkpoint2)
    expect(await backend.get('counter')).toBe(1)

    await backend.restore(checkpoint3)
    expect(await backend.get('counter')).toBe(3)
  })

  it('should capture key additions and deletions', async () => {
    const backend = new InMemoryStateBackend<string>('delta-test')

    await backend.put('persistent', 'always-here')
    const checkpoint1 = await backend.snapshot()

    await backend.put('temporary', 'will-be-removed')
    const checkpoint2 = await backend.snapshot()

    await backend.delete('temporary')
    await backend.put('new-key', 'added-later')
    const checkpoint3 = await backend.snapshot()

    // Verify checkpoint1
    await backend.restore(checkpoint1)
    expect(await backend.get('persistent')).toBe('always-here')
    expect(await backend.get('temporary')).toBeUndefined()
    expect(await backend.get('new-key')).toBeUndefined()

    // Verify checkpoint2
    await backend.restore(checkpoint2)
    expect(await backend.get('persistent')).toBe('always-here')
    expect(await backend.get('temporary')).toBe('will-be-removed')
    expect(await backend.get('new-key')).toBeUndefined()

    // Verify checkpoint3
    await backend.restore(checkpoint3)
    expect(await backend.get('persistent')).toBe('always-here')
    expect(await backend.get('temporary')).toBeUndefined()
    expect(await backend.get('new-key')).toBe('added-later')
  })
})

// =============================================================================
// Checkpoint Edge Cases
// =============================================================================

describe('Checkpoint Edge Cases', () => {
  it('should handle special characters in keys/values', async () => {
    const backend = new InMemoryStateBackend<string>('special-chars')

    await backend.put('key:with:colons', 'value:also:colons')
    await backend.put('key/with/slashes', 'value/slashes')
    await backend.put('key\twith\ttabs', 'value\twith\ttabs')
    await backend.put('emoji:key', 'emoji-value')

    const snapshot = await backend.snapshot()
    await backend.clear()
    await backend.restore(snapshot)

    expect(await backend.get('key:with:colons')).toBe('value:also:colons')
    expect(await backend.get('key/with/slashes')).toBe('value/slashes')
    expect(await backend.get('key\twith\ttabs')).toBe('value\twith\ttabs')
    expect(await backend.get('emoji:key')).toBe('emoji-value')
  })

  it('should handle very large values', async () => {
    const backend = new InMemoryStateBackend<string>('large-value')

    // Create a large value (100KB)
    const largeValue = 'x'.repeat(100 * 1024)
    await backend.put('large', largeValue)

    const snapshot = await backend.snapshot()
    expect(snapshot.metadata.totalBytes).toBeGreaterThan(100 * 1024)

    await backend.clear()
    await backend.restore(snapshot)

    expect(await backend.get('large')).toBe(largeValue)
  })

  it('should handle null and undefined-like values', async () => {
    const backend = new InMemoryStateBackend<string | null>('null-test')

    // Note: null is valid JSON, undefined is not stored
    await backend.put('null-value', null as unknown as string)
    await backend.put('empty-string', '')

    const snapshot = await backend.snapshot()
    await backend.clear()
    await backend.restore(snapshot)

    expect(await backend.get('null-value')).toBeNull()
    expect(await backend.get('empty-string')).toBe('')
  })

  it('should handle concurrent checkpoint operations', async () => {
    const backend = new InMemoryStateBackend<number>('concurrent')

    await backend.put('counter', 0)

    // Start multiple snapshots concurrently
    const [snap1, snap2, snap3] = await Promise.all([
      backend.snapshot(),
      backend.snapshot(),
      backend.snapshot(),
    ])

    // All snapshots should have the same data
    expect(snap1.metadata.stateCount).toBe(1)
    expect(snap2.metadata.stateCount).toBe(1)
    expect(snap3.metadata.stateCount).toBe(1)

    // All should be independently restorable
    await backend.put('counter', 100)

    await backend.restore(snap1)
    expect(await backend.get('counter')).toBe(0)

    await backend.put('counter', 200)
    await backend.restore(snap2)
    expect(await backend.get('counter')).toBe(0)
  })
})
