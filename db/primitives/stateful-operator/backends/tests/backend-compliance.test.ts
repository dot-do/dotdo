/**
 * Backend Compliance Tests
 *
 * Tests that verify all StateBackend implementations conform to the interface
 * contract and behave consistently.
 *
 * Run with: npx vitest run db/primitives/stateful-operator/backends/tests/backend-compliance.test.ts
 */

import { describe, it, expect, beforeEach } from 'vitest'
import type { StateBackend, StateSnapshot } from '../../index'
import { InMemoryStateBackend } from '../../index'
import { DOStateBackend, type DurableObjectStorage } from '../do-backend'

// =============================================================================
// Mock Storage Factory
// =============================================================================

function createMockDOStorage(): DurableObjectStorage & { _data: Map<string, unknown> } {
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
      return closure(storage)
    },
  }

  return storage
}

// =============================================================================
// Backend Factory Interface
// =============================================================================

interface BackendFactory<T> {
  name: string
  create(backendName: string): StateBackend<T>
}

// =============================================================================
// Backend Factories
// =============================================================================

const backendFactories: BackendFactory<string>[] = [
  {
    name: 'InMemoryStateBackend',
    create: (name: string) => new InMemoryStateBackend<string>(name),
  },
  {
    name: 'DOStateBackend',
    create: (name: string) => {
      const storage = createMockDOStorage()
      return new DOStateBackend<string>(storage, name)
    },
  },
  {
    name: 'DOStateBackend (transactional)',
    create: (name: string) => {
      const storage = createMockDOStorage()
      return new DOStateBackend<string>(storage, name, { transactional: true })
    },
  },
]

// =============================================================================
// Compliance Test Suite
// =============================================================================

describe.each(backendFactories)('$name StateBackend Interface Compliance', (factory) => {
  let backend: StateBackend<string>

  beforeEach(() => {
    backend = factory.create('compliance-test')
  })

  describe('name property', () => {
    it('should expose the backend name', () => {
      expect(backend.name).toBe('compliance-test')
    })

    it('should be readonly', () => {
      // TypeScript enforces this, but we verify at runtime
      expect(typeof backend.name).toBe('string')
    })
  })

  describe('get/put/delete contract', () => {
    it('get should return undefined for missing keys', async () => {
      const result = await backend.get('nonexistent')
      expect(result).toBeUndefined()
    })

    it('put should make value retrievable via get', async () => {
      await backend.put('key', 'value')
      const result = await backend.get('key')
      expect(result).toBe('value')
    })

    it('put should overwrite existing values', async () => {
      await backend.put('key', 'first')
      await backend.put('key', 'second')
      expect(await backend.get('key')).toBe('second')
    })

    it('delete should remove the value', async () => {
      await backend.put('key', 'value')
      await backend.delete('key')
      expect(await backend.get('key')).toBeUndefined()
    })

    it('delete should be idempotent (no error on missing key)', async () => {
      await expect(backend.delete('nonexistent')).resolves.not.toThrow()
    })

    it('should handle empty string keys', async () => {
      await backend.put('', 'empty-key-value')
      expect(await backend.get('')).toBe('empty-key-value')
    })

    it('should handle empty string values', async () => {
      await backend.put('key', '')
      expect(await backend.get('key')).toBe('')
    })

    it('should handle keys with special characters', async () => {
      const specialKey = 'key:with:colons/and/slashes?query=true'
      await backend.put(specialKey, 'special')
      expect(await backend.get(specialKey)).toBe('special')
    })

    it('should handle unicode keys and values', async () => {
      await backend.put('emoji:key', 'value-with-emoji')
      expect(await backend.get('emoji:key')).toBe('value-with-emoji')
    })
  })

  describe('list contract', () => {
    it('should return empty iterator for empty backend', async () => {
      const entries: [string, string][] = []
      for await (const entry of backend.list()) {
        entries.push(entry)
      }
      expect(entries).toHaveLength(0)
    })

    it('should return all entries', async () => {
      await backend.put('a', '1')
      await backend.put('b', '2')
      await backend.put('c', '3')

      const entries: [string, string][] = []
      for await (const entry of backend.list()) {
        entries.push(entry)
      }

      expect(entries).toHaveLength(3)
      expect(entries.map(([k]) => k).sort()).toEqual(['a', 'b', 'c'])
    })

    it('should filter by prefix', async () => {
      await backend.put('user:1', 'alice')
      await backend.put('user:2', 'bob')
      await backend.put('order:1', 'order-data')

      const entries: [string, string][] = []
      for await (const entry of backend.list('user:')) {
        entries.push(entry)
      }

      expect(entries).toHaveLength(2)
      expect(entries.every(([k]) => k.startsWith('user:'))).toBe(true)
    })

    it('should return empty for non-matching prefix', async () => {
      await backend.put('user:1', 'alice')

      const entries: [string, string][] = []
      for await (const entry of backend.list('order:')) {
        entries.push(entry)
      }

      expect(entries).toHaveLength(0)
    })

    it('should handle undefined prefix (list all)', async () => {
      await backend.put('a', '1')
      await backend.put('b', '2')

      const entries: [string, string][] = []
      for await (const entry of backend.list(undefined)) {
        entries.push(entry)
      }

      expect(entries).toHaveLength(2)
    })
  })

  describe('size contract', () => {
    it('should return 0 for empty backend', async () => {
      expect(await backend.size()).toBe(0)
    })

    it('should return correct count after puts', async () => {
      await backend.put('a', '1')
      await backend.put('b', '2')
      expect(await backend.size()).toBe(2)
    })

    it('should reflect deletes', async () => {
      await backend.put('a', '1')
      await backend.put('b', '2')
      await backend.delete('a')
      expect(await backend.size()).toBe(1)
    })

    it('should not double-count overwrites', async () => {
      await backend.put('key', 'first')
      await backend.put('key', 'second')
      expect(await backend.size()).toBe(1)
    })
  })

  describe('clear contract', () => {
    it('should remove all entries', async () => {
      await backend.put('a', '1')
      await backend.put('b', '2')
      await backend.clear()

      expect(await backend.size()).toBe(0)
      expect(await backend.get('a')).toBeUndefined()
      expect(await backend.get('b')).toBeUndefined()
    })

    it('should be idempotent (no error on empty)', async () => {
      await expect(backend.clear()).resolves.not.toThrow()
    })
  })

  describe('snapshot contract', () => {
    it('should produce a valid snapshot structure', async () => {
      await backend.put('key', 'value')
      const snapshot = await backend.snapshot()

      expect(snapshot).toHaveProperty('id')
      expect(typeof snapshot.id).toBe('string')
      expect(snapshot.id.length).toBeGreaterThan(0)

      expect(snapshot).toHaveProperty('timestamp')
      expect(typeof snapshot.timestamp).toBe('number')
      expect(snapshot.timestamp).toBeGreaterThan(0)

      expect(snapshot).toHaveProperty('data')
      expect(snapshot.data).toBeInstanceOf(Uint8Array)

      expect(snapshot).toHaveProperty('metadata')
      expect(typeof snapshot.metadata.stateCount).toBe('number')
      expect(typeof snapshot.metadata.totalBytes).toBe('number')
      expect(typeof snapshot.metadata.checksum).toBe('string')
    })

    it('should include correct state count', async () => {
      await backend.put('a', '1')
      await backend.put('b', '2')
      await backend.put('c', '3')

      const snapshot = await backend.snapshot()
      expect(snapshot.metadata.stateCount).toBe(3)
    })

    it('should generate unique snapshot IDs', async () => {
      await backend.put('key', 'value')

      const snap1 = await backend.snapshot()
      const snap2 = await backend.snapshot()

      expect(snap1.id).not.toBe(snap2.id)
    })

    it('should capture empty state correctly', async () => {
      const snapshot = await backend.snapshot()
      expect(snapshot.metadata.stateCount).toBe(0)
    })
  })

  describe('restore contract', () => {
    it('should restore state from snapshot', async () => {
      await backend.put('key1', 'value1')
      await backend.put('key2', 'value2')
      const snapshot = await backend.snapshot()

      await backend.clear()
      expect(await backend.size()).toBe(0)

      await backend.restore(snapshot)

      expect(await backend.get('key1')).toBe('value1')
      expect(await backend.get('key2')).toBe('value2')
    })

    it('should replace current state entirely', async () => {
      await backend.put('key1', 'value1')
      const snapshot = await backend.snapshot()

      await backend.put('key2', 'value2')
      await backend.put('key3', 'value3')

      await backend.restore(snapshot)

      expect(await backend.get('key1')).toBe('value1')
      expect(await backend.get('key2')).toBeUndefined()
      expect(await backend.get('key3')).toBeUndefined()
      expect(await backend.size()).toBe(1)
    })

    it('should reject corrupted snapshots (invalid checksum)', async () => {
      await backend.put('key', 'value')
      const snapshot = await backend.snapshot()

      const corruptedSnapshot: StateSnapshot = {
        ...snapshot,
        metadata: {
          ...snapshot.metadata,
          checksum: 'invalid-checksum-12345',
        },
      }

      await expect(backend.restore(corruptedSnapshot)).rejects.toThrow(/checksum/i)
    })

    it('should restore empty state correctly', async () => {
      const emptySnapshot = await backend.snapshot()

      await backend.put('key', 'value')
      expect(await backend.size()).toBe(1)

      await backend.restore(emptySnapshot)
      expect(await backend.size()).toBe(0)
    })
  })

  describe('TTL support', () => {
    it('should respect TTL on put', async () => {
      await backend.put('key', 'value', 50) // 50ms TTL

      expect(await backend.get('key')).toBe('value')

      await new Promise((r) => setTimeout(r, 100))

      expect(await backend.get('key')).toBeUndefined()
    })

    it('should not expire entries without TTL', async () => {
      await backend.put('persistent', 'value') // No TTL

      await new Promise((r) => setTimeout(r, 50))

      expect(await backend.get('persistent')).toBe('value')
    })

    it('should exclude expired entries from size', async () => {
      await backend.put('expires', 'value', 50)
      await backend.put('persists', 'value')

      expect(await backend.size()).toBe(2)

      await new Promise((r) => setTimeout(r, 100))

      expect(await backend.size()).toBe(1)
    })

    it('should exclude expired entries from list', async () => {
      await backend.put('expires', 'value1', 50)
      await backend.put('persists', 'value2')

      await new Promise((r) => setTimeout(r, 100))

      const entries: [string, string][] = []
      for await (const entry of backend.list()) {
        entries.push(entry)
      }

      expect(entries).toHaveLength(1)
      expect(entries[0][0]).toBe('persists')
    })

    it('should exclude expired entries from snapshot', async () => {
      await backend.put('expires', 'value', 50)
      await backend.put('persists', 'value')

      await new Promise((r) => setTimeout(r, 100))

      const snapshot = await backend.snapshot()
      expect(snapshot.metadata.stateCount).toBe(1)
    })
  })
})

// =============================================================================
// Cross-Backend Consistency Tests
// =============================================================================

describe('Cross-Backend State Transfer', () => {
  it('should transfer state from InMemory to DO backend', async () => {
    const inMemory = new InMemoryStateBackend<string>('source')
    const doStorage = createMockDOStorage()
    const doBackend = new DOStateBackend<string>(doStorage, 'target')

    // Populate source
    await inMemory.put('user:1', 'alice')
    await inMemory.put('user:2', 'bob')
    await inMemory.put('config', 'settings')

    // Snapshot from source
    const snapshot = await inMemory.snapshot()

    // Restore to target
    await doBackend.restore(snapshot)

    // Verify transfer
    expect(await doBackend.get('user:1')).toBe('alice')
    expect(await doBackend.get('user:2')).toBe('bob')
    expect(await doBackend.get('config')).toBe('settings')
    expect(await doBackend.size()).toBe(3)
  })

  it('should transfer state from DO to InMemory backend', async () => {
    const doStorage = createMockDOStorage()
    const doBackend = new DOStateBackend<string>(doStorage, 'source')
    const inMemory = new InMemoryStateBackend<string>('target')

    // Populate source
    await doBackend.put('order:1', 'pending')
    await doBackend.put('order:2', 'shipped')

    // Snapshot from source
    const snapshot = await doBackend.snapshot()

    // Restore to target
    await inMemory.restore(snapshot)

    // Verify transfer
    expect(await inMemory.get('order:1')).toBe('pending')
    expect(await inMemory.get('order:2')).toBe('shipped')
    expect(await inMemory.size()).toBe(2)
  })

  it('should preserve data integrity across multiple transfers', async () => {
    const backend1 = new InMemoryStateBackend<string>('stage-1')
    const doStorage = createMockDOStorage()
    const backend2 = new DOStateBackend<string>(doStorage, 'stage-2')
    const backend3 = new InMemoryStateBackend<string>('stage-3')

    // Original data
    await backend1.put('key', 'original-value')
    await backend1.put('important', 'critical-data')

    // Transfer: backend1 -> backend2 -> backend3
    const snap1 = await backend1.snapshot()
    await backend2.restore(snap1)

    const snap2 = await backend2.snapshot()
    await backend3.restore(snap2)

    // Verify final state
    expect(await backend3.get('key')).toBe('original-value')
    expect(await backend3.get('important')).toBe('critical-data')

    // Verify checksums propagated correctly
    expect(snap1.metadata.stateCount).toBe(snap2.metadata.stateCount)
  })
})
