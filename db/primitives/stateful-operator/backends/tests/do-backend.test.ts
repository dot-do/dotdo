/**
 * DOStateBackend Tests
 *
 * Tests for the Durable Object state backend implementation.
 * These tests run in the Cloudflare Workers runtime using miniflare.
 *
 * Run with: npx vitest run --project=do-state-backend db/primitives/stateful-operator/backends/tests/do-backend.test.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  DOStateBackend,
  createDOStateBackend,
  type DurableObjectStorage,
} from '../do-backend'
import type { StateBackend, StateSnapshot } from '../../index'

// Mock DurableObjectStorage for unit testing
// This allows testing the backend logic without requiring actual DO runtime
function createMockStorage(): DurableObjectStorage & {
  _data: Map<string, unknown>
} {
  const data = new Map<string, unknown>()

  const storage: DurableObjectStorage & { _data: Map<string, unknown> } = {
    _data: data,

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

      // Sort keys for consistent ordering
      const sortedKeys = [...data.keys()].sort()
      const keysToIterate = options?.reverse ? sortedKeys.reverse() : sortedKeys

      for (const key of keysToIterate) {
        // Apply prefix filter
        if (options?.prefix && !key.startsWith(options.prefix)) {
          continue
        }

        // Apply start filter
        if (options?.start && key < options.start) {
          continue
        }

        // Apply end filter
        if (options?.end && key >= options.end) {
          continue
        }

        // Apply limit
        if (options?.limit !== undefined && count >= options.limit) {
          break
        }

        result.set(key, data.get(key) as T)
        count++
      }

      return result
    },

    async transaction<T>(closure: (txn: DurableObjectStorage) => Promise<T>): Promise<T> {
      // For mock, just run the closure directly
      // Real DO storage provides ACID guarantees
      return closure(storage)
    },
  }

  return storage
}

describe('DOStateBackend', () => {
  let storage: ReturnType<typeof createMockStorage>
  let backend: DOStateBackend<string>

  beforeEach(() => {
    storage = createMockStorage()
    backend = new DOStateBackend<string>(storage, 'test-state')
  })

  describe('basic CRUD operations', () => {
    it('should return undefined for non-existent keys', async () => {
      const value = await backend.get('missing-key')
      expect(value).toBeUndefined()
    })

    it('should put and get values', async () => {
      await backend.put('key1', 'value1')
      const value = await backend.get('key1')
      expect(value).toBe('value1')
    })

    it('should overwrite existing values', async () => {
      await backend.put('key1', 'value1')
      await backend.put('key1', 'value2')
      const value = await backend.get('key1')
      expect(value).toBe('value2')
    })

    it('should delete values', async () => {
      await backend.put('key1', 'value1')
      await backend.delete('key1')
      const value = await backend.get('key1')
      expect(value).toBeUndefined()
    })

    it('should delete non-existent keys without error', async () => {
      await expect(backend.delete('missing')).resolves.toBeUndefined()
    })

    it('should use name as key prefix in storage', async () => {
      await backend.put('key1', 'value1')
      // Check the underlying storage has the prefixed key
      expect(storage._data.has('test-state:key1')).toBe(true)
    })
  })

  describe('list operations', () => {
    it('should list all entries', async () => {
      await backend.put('a', 'valueA')
      await backend.put('b', 'valueB')
      await backend.put('c', 'valueC')

      const entries: [string, string][] = []
      for await (const entry of backend.list()) {
        entries.push(entry)
      }

      expect(entries).toHaveLength(3)
      expect(entries.map(([k]) => k).sort()).toEqual(['a', 'b', 'c'])
    })

    it('should list entries with prefix filter', async () => {
      await backend.put('user:1', 'alice')
      await backend.put('user:2', 'bob')
      await backend.put('order:1', 'order1')

      const entries: [string, string][] = []
      for await (const entry of backend.list('user:')) {
        entries.push(entry)
      }

      expect(entries).toHaveLength(2)
      expect(entries.map(([k]) => k).sort()).toEqual(['user:1', 'user:2'])
    })

    it('should return empty iterator for non-matching prefix', async () => {
      await backend.put('user:1', 'alice')

      const entries: [string, string][] = []
      for await (const entry of backend.list('order:')) {
        entries.push(entry)
      }

      expect(entries).toHaveLength(0)
    })

    it('should not include entries from other backends', async () => {
      // Create another backend with different name
      const otherBackend = new DOStateBackend<string>(storage, 'other-state')

      await backend.put('key1', 'value1')
      await otherBackend.put('key2', 'value2')

      const entries: [string, string][] = []
      for await (const entry of backend.list()) {
        entries.push(entry)
      }

      expect(entries).toHaveLength(1)
      expect(entries[0]).toEqual(['key1', 'value1'])
    })
  })

  describe('size operations', () => {
    it('should return 0 for empty backend', async () => {
      const size = await backend.size()
      expect(size).toBe(0)
    })

    it('should return correct size after operations', async () => {
      await backend.put('a', 'va')
      await backend.put('b', 'vb')
      expect(await backend.size()).toBe(2)

      await backend.delete('a')
      expect(await backend.size()).toBe(1)
    })
  })

  describe('clear operations', () => {
    it('should remove all entries', async () => {
      await backend.put('a', 'va')
      await backend.put('b', 'vb')
      await backend.clear()

      expect(await backend.size()).toBe(0)
      expect(await backend.get('a')).toBeUndefined()
    })

    it('should not affect other backends', async () => {
      const otherBackend = new DOStateBackend<string>(storage, 'other-state')

      await backend.put('key1', 'value1')
      await otherBackend.put('key2', 'value2')

      await backend.clear()

      expect(await backend.get('key1')).toBeUndefined()
      expect(await otherBackend.get('key2')).toBe('value2')
    })
  })

  describe('snapshot and restore', () => {
    it('should create a snapshot with metadata', async () => {
      await backend.put('key1', 'value1')
      await backend.put('key2', 'value2')

      const snapshot = await backend.snapshot()

      expect(snapshot.id).toBeDefined()
      expect(snapshot.id).toContain('test-state')
      expect(snapshot.timestamp).toBeGreaterThan(0)
      expect(snapshot.data).toBeInstanceOf(Uint8Array)
      expect(snapshot.metadata.stateCount).toBe(2)
      expect(snapshot.metadata.totalBytes).toBeGreaterThan(0)
      expect(snapshot.metadata.checksum).toBeDefined()
    })

    it('should restore from snapshot', async () => {
      await backend.put('key1', 'value1')
      await backend.put('key2', 'value2')

      const snapshot = await backend.snapshot()

      // Clear and verify empty
      await backend.clear()
      expect(await backend.size()).toBe(0)

      // Restore
      await backend.restore(snapshot)

      expect(await backend.get('key1')).toBe('value1')
      expect(await backend.get('key2')).toBe('value2')
    })

    it('should validate checksum on restore', async () => {
      await backend.put('key1', 'value1')
      const snapshot = await backend.snapshot()

      // Corrupt the snapshot
      const corruptSnapshot: StateSnapshot = {
        ...snapshot,
        metadata: {
          ...snapshot.metadata,
          checksum: 'invalid-checksum',
        },
      }

      await expect(backend.restore(corruptSnapshot)).rejects.toThrow(/checksum/i)
    })

    it('should atomically restore (transaction)', async () => {
      await backend.put('key1', 'value1')
      await backend.put('key2', 'value2')

      const snapshot = await backend.snapshot()

      // Add more keys after snapshot
      await backend.put('key3', 'value3')
      await backend.put('key4', 'value4')

      // Restore should replace all keys atomically
      await backend.restore(snapshot)

      expect(await backend.get('key1')).toBe('value1')
      expect(await backend.get('key2')).toBe('value2')
      expect(await backend.get('key3')).toBeUndefined()
      expect(await backend.get('key4')).toBeUndefined()
    })
  })

  describe('TTL support', () => {
    it('should support TTL on put', async () => {
      await backend.put('key1', 'value1', 100) // 100ms TTL

      expect(await backend.get('key1')).toBe('value1')

      // Wait for TTL to expire
      await new Promise((r) => setTimeout(r, 150))

      expect(await backend.get('key1')).toBeUndefined()
    })

    it('should filter expired entries in list', async () => {
      await backend.put('key1', 'value1', 100) // 100ms TTL
      await backend.put('key2', 'value2') // No TTL

      // Wait for TTL to expire
      await new Promise((r) => setTimeout(r, 150))

      const entries: [string, string][] = []
      for await (const entry of backend.list()) {
        entries.push(entry)
      }

      expect(entries).toHaveLength(1)
      expect(entries[0]).toEqual(['key2', 'value2'])
    })

    it('should exclude expired entries from size', async () => {
      await backend.put('key1', 'value1', 100) // 100ms TTL
      await backend.put('key2', 'value2') // No TTL

      expect(await backend.size()).toBe(2)

      // Wait for TTL to expire
      await new Promise((r) => setTimeout(r, 150))

      expect(await backend.size()).toBe(1)
    })

    it('should exclude expired entries from snapshot', async () => {
      await backend.put('key1', 'value1', 100) // 100ms TTL
      await backend.put('key2', 'value2') // No TTL

      // Wait for TTL to expire
      await new Promise((r) => setTimeout(r, 150))

      const snapshot = await backend.snapshot()
      expect(snapshot.metadata.stateCount).toBe(1)

      // Restore to new backend and verify
      await backend.clear()
      await backend.restore(snapshot)

      expect(await backend.get('key1')).toBeUndefined()
      expect(await backend.get('key2')).toBe('value2')
    })
  })

  describe('batch operations', () => {
    it('should batch put multiple entries', async () => {
      const entries = new Map([
        ['key1', 'value1'],
        ['key2', 'value2'],
        ['key3', 'value3'],
      ])

      await backend.putBatch(entries)

      expect(await backend.get('key1')).toBe('value1')
      expect(await backend.get('key2')).toBe('value2')
      expect(await backend.get('key3')).toBe('value3')
    })

    it('should batch put with TTL', async () => {
      const entries = new Map([
        ['key1', 'value1'],
        ['key2', 'value2'],
      ])

      await backend.putBatch(entries, 100) // 100ms TTL

      expect(await backend.get('key1')).toBe('value1')

      // Wait for TTL to expire
      await new Promise((r) => setTimeout(r, 150))

      expect(await backend.get('key1')).toBeUndefined()
      expect(await backend.get('key2')).toBeUndefined()
    })

    it('should batch delete multiple entries', async () => {
      await backend.put('key1', 'value1')
      await backend.put('key2', 'value2')
      await backend.put('key3', 'value3')

      await backend.deleteBatch(['key1', 'key3'])

      expect(await backend.get('key1')).toBeUndefined()
      expect(await backend.get('key2')).toBe('value2')
      expect(await backend.get('key3')).toBeUndefined()
    })

    it('should batch get multiple entries', async () => {
      await backend.put('key1', 'value1')
      await backend.put('key2', 'value2')
      await backend.put('key3', 'value3')

      const result = await backend.getBatch(['key1', 'key3', 'missing'])

      expect(result.size).toBe(2)
      expect(result.get('key1')).toBe('value1')
      expect(result.get('key3')).toBe('value3')
      expect(result.has('missing')).toBe(false)
    })

    it('should exclude expired entries from batch get', async () => {
      await backend.put('key1', 'value1', 100) // 100ms TTL
      await backend.put('key2', 'value2')

      // Wait for TTL to expire
      await new Promise((r) => setTimeout(r, 150))

      const result = await backend.getBatch(['key1', 'key2'])

      expect(result.size).toBe(1)
      expect(result.get('key2')).toBe('value2')
      expect(result.has('key1')).toBe(false)
    })
  })

  describe('cleanup', () => {
    it('should clean up expired entries', async () => {
      await backend.put('key1', 'value1', 100) // 100ms TTL
      await backend.put('key2', 'value2', 100) // 100ms TTL
      await backend.put('key3', 'value3') // No TTL

      // Wait for TTL to expire
      await new Promise((r) => setTimeout(r, 150))

      const cleaned = await backend.cleanup()

      expect(cleaned).toBe(2)

      // Verify entries are actually removed from storage
      expect(storage._data.has('test-state:key1')).toBe(false)
      expect(storage._data.has('test-state:key2')).toBe(false)
      expect(storage._data.has('test-state:key3')).toBe(true)
    })

    it('should return 0 when no entries are expired', async () => {
      await backend.put('key1', 'value1')
      await backend.put('key2', 'value2')

      const cleaned = await backend.cleanup()
      expect(cleaned).toBe(0)
    })
  })

  describe('transactional mode', () => {
    it('should use transactions when enabled', async () => {
      const transactionalBackend = new DOStateBackend<string>(storage, 'txn-state', {
        transactional: true,
      })

      // Track transaction calls
      const transactionSpy = vi.spyOn(storage, 'transaction')

      await transactionalBackend.put('key1', 'value1')
      await transactionalBackend.delete('key1')

      expect(transactionSpy).toHaveBeenCalledTimes(2)
    })

    it('should not use transactions when disabled', async () => {
      // Track transaction calls
      const transactionSpy = vi.spyOn(storage, 'transaction')

      await backend.put('key1', 'value1')
      await backend.delete('key1')

      // snapshot/restore/clear always use transactions, but put/delete shouldn't
      expect(transactionSpy).not.toHaveBeenCalled()
    })
  })

  describe('factory function', () => {
    it('should create backend with createDOStateBackend', async () => {
      const factoryBackend = createDOStateBackend<number>(storage, 'factory-state')

      await factoryBackend.put('count', 42)
      expect(await factoryBackend.get('count')).toBe(42)
    })

    it('should accept options', async () => {
      const factoryBackend = createDOStateBackend<string>(storage, 'options-state', {
        transactional: true,
        listBatchSize: 500,
      })

      const transactionSpy = vi.spyOn(storage, 'transaction')

      await factoryBackend.put('key', 'value')
      expect(transactionSpy).toHaveBeenCalled()
    })
  })

  describe('concurrent state backends', () => {
    it('should isolate state between backends with different names', async () => {
      const backend1 = new DOStateBackend<string>(storage, 'backend-1')
      const backend2 = new DOStateBackend<string>(storage, 'backend-2')

      await backend1.put('key', 'value1')
      await backend2.put('key', 'value2')

      expect(await backend1.get('key')).toBe('value1')
      expect(await backend2.get('key')).toBe('value2')

      await backend1.clear()

      expect(await backend1.get('key')).toBeUndefined()
      expect(await backend2.get('key')).toBe('value2')
    })

    it('should handle snapshots independently', async () => {
      const backend1 = new DOStateBackend<string>(storage, 'backend-1')
      const backend2 = new DOStateBackend<string>(storage, 'backend-2')

      await backend1.put('key1', 'value1')
      await backend2.put('key2', 'value2')

      const snapshot1 = await backend1.snapshot()
      const snapshot2 = await backend2.snapshot()

      expect(snapshot1.metadata.stateCount).toBe(1)
      expect(snapshot2.metadata.stateCount).toBe(1)

      // Restore backend1 should not affect backend2
      await backend1.clear()
      await backend1.put('newkey', 'newvalue')
      await backend1.restore(snapshot1)

      expect(await backend1.get('key1')).toBe('value1')
      expect(await backend1.get('newkey')).toBeUndefined()
      expect(await backend2.get('key2')).toBe('value2')
    })
  })
})

describe('DOStateBackend Integration', () => {
  it('should support full checkpoint-restore cycle', async () => {
    const storage = createMockStorage()
    const backend = new DOStateBackend<number>(storage, 'integration-test')

    // Accumulate some state
    await backend.put('user:1', 10)
    await backend.put('user:2', 20)
    await backend.put('user:1', 15) // Update

    // Snapshot
    const snapshot = await backend.snapshot()

    // Modify state after snapshot
    await backend.put('user:1', 115)
    await backend.put('user:3', 999)

    // Verify modified state
    expect(await backend.get('user:1')).toBe(115)
    expect(await backend.get('user:3')).toBe(999)

    // Restore from snapshot
    await backend.restore(snapshot)

    // Verify restored state
    expect(await backend.get('user:1')).toBe(15) // Original value
    expect(await backend.get('user:2')).toBe(20)
    expect(await backend.get('user:3')).toBeUndefined() // Didn't exist
  })

  it('should work with complex value types', async () => {
    const storage = createMockStorage()

    interface UserState {
      name: string
      score: number
      tags: string[]
    }

    const backend = new DOStateBackend<UserState>(storage, 'complex-state')

    const user: UserState = {
      name: 'Alice',
      score: 100,
      tags: ['premium', 'active'],
    }

    await backend.put('user:1', user)

    const retrieved = await backend.get('user:1')
    expect(retrieved).toEqual(user)

    // Snapshot and restore
    const snapshot = await backend.snapshot()
    await backend.clear()
    await backend.restore(snapshot)

    const restored = await backend.get('user:1')
    expect(restored).toEqual(user)
  })
})
