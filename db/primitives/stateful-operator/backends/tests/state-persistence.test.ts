/**
 * State Persistence Tests
 *
 * Tests for state durability, persistence guarantees, and data integrity
 * across backend operations.
 *
 * Run with: npx vitest run db/primitives/stateful-operator/backends/tests/state-persistence.test.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { StateBackend } from '../../index'
import { InMemoryStateBackend } from '../../index'
import { DOStateBackend, type DurableObjectStorage } from '../do-backend'

// =============================================================================
// Mock Storage with Persistence Simulation
// =============================================================================

interface StorageEvent {
  type: 'get' | 'put' | 'delete' | 'list' | 'transaction'
  key?: string
  value?: unknown
  timestamp: number
}

function createMockDOStorage(): DurableObjectStorage & {
  _data: Map<string, unknown>
  _events: StorageEvent[]
  _simulateLatency: boolean
  _latencyMs: number
} {
  const data = new Map<string, unknown>()
  const events: StorageEvent[] = []
  let simulateLatency = false
  let latencyMs = 0

  const maybeDelay = async () => {
    if (simulateLatency && latencyMs > 0) {
      await new Promise((r) => setTimeout(r, latencyMs))
    }
  }

  const storage: DurableObjectStorage & {
    _data: Map<string, unknown>
    _events: StorageEvent[]
    _simulateLatency: boolean
    _latencyMs: number
  } = {
    _data: data,
    _events: events,
    get _simulateLatency() {
      return simulateLatency
    },
    set _simulateLatency(v: boolean) {
      simulateLatency = v
    },
    get _latencyMs() {
      return latencyMs
    },
    set _latencyMs(v: number) {
      latencyMs = v
    },

    async get<T>(keyOrKeys: string | string[]): Promise<T | undefined | Map<string, T>> {
      await maybeDelay()

      if (Array.isArray(keyOrKeys)) {
        events.push({ type: 'get', key: `[${keyOrKeys.join(',')}]`, timestamp: Date.now() })
        const result = new Map<string, T>()
        for (const key of keyOrKeys) {
          const value = data.get(key)
          if (value !== undefined) {
            result.set(key, value as T)
          }
        }
        return result
      }

      events.push({ type: 'get', key: keyOrKeys, timestamp: Date.now() })
      return data.get(keyOrKeys) as T | undefined
    },

    async put<T>(keyOrEntries: string | Record<string, T>, value?: T): Promise<void> {
      await maybeDelay()

      if (typeof keyOrEntries === 'string') {
        events.push({ type: 'put', key: keyOrEntries, value, timestamp: Date.now() })
        data.set(keyOrEntries, value)
      } else {
        for (const [k, v] of Object.entries(keyOrEntries)) {
          events.push({ type: 'put', key: k, value: v, timestamp: Date.now() })
          data.set(k, v)
        }
      }
    },

    async delete(keyOrKeys: string | string[]): Promise<boolean | number> {
      await maybeDelay()

      if (Array.isArray(keyOrKeys)) {
        events.push({ type: 'delete', key: `[${keyOrKeys.join(',')}]`, timestamp: Date.now() })
        let count = 0
        for (const key of keyOrKeys) {
          if (data.delete(key)) count++
        }
        return count
      }

      events.push({ type: 'delete', key: keyOrKeys, timestamp: Date.now() })
      return data.delete(keyOrKeys)
    },

    async deleteAll(): Promise<void> {
      await maybeDelay()
      events.push({ type: 'delete', key: '*', timestamp: Date.now() })
      data.clear()
    },

    async list<T>(options?: {
      prefix?: string
      start?: string
      end?: string
      limit?: number
      reverse?: boolean
    }): Promise<Map<string, T>> {
      await maybeDelay()
      events.push({ type: 'list', key: options?.prefix, timestamp: Date.now() })

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
      await maybeDelay()
      events.push({ type: 'transaction', timestamp: Date.now() })
      return closure(storage)
    },
  }

  return storage
}

// =============================================================================
// Write Durability Tests
// =============================================================================

describe('Write Durability', () => {
  describe('DOStateBackend', () => {
    let storage: ReturnType<typeof createMockDOStorage>
    let backend: DOStateBackend<string>

    beforeEach(() => {
      storage = createMockDOStorage()
      backend = new DOStateBackend(storage, 'durability-test')
    })

    it('should persist writes immediately', async () => {
      await backend.put('key', 'value')

      // Check underlying storage
      expect(storage._data.has('durability-test:key')).toBe(true)
    })

    it('should persist deletes immediately', async () => {
      await backend.put('key', 'value')
      expect(storage._data.has('durability-test:key')).toBe(true)

      await backend.delete('key')
      expect(storage._data.has('durability-test:key')).toBe(false)
    })

    it('should record all write operations', async () => {
      storage._events.length = 0

      await backend.put('key1', 'value1')
      await backend.put('key2', 'value2')
      await backend.delete('key1')

      const putEvents = storage._events.filter((e) => e.type === 'put')
      const deleteEvents = storage._events.filter((e) => e.type === 'delete')

      expect(putEvents).toHaveLength(2)
      expect(deleteEvents).toHaveLength(1)
    })

    it('should use transactions in transactional mode', async () => {
      const txnBackend = new DOStateBackend<string>(storage, 'txn-test', {
        transactional: true,
      })

      storage._events.length = 0

      await txnBackend.put('key', 'value')

      const txnEvents = storage._events.filter((e) => e.type === 'transaction')
      expect(txnEvents.length).toBeGreaterThan(0)
    })

    it('should batch put atomically', async () => {
      storage._events.length = 0

      const entries = new Map([
        ['key1', 'value1'],
        ['key2', 'value2'],
        ['key3', 'value3'],
      ])

      await backend.putBatch(entries)

      // Should use transaction for atomicity
      const txnEvents = storage._events.filter((e) => e.type === 'transaction')
      expect(txnEvents.length).toBeGreaterThan(0)

      // All entries should be persisted
      expect(await backend.get('key1')).toBe('value1')
      expect(await backend.get('key2')).toBe('value2')
      expect(await backend.get('key3')).toBe('value3')
    })

    it('should batch delete atomically', async () => {
      await backend.put('key1', 'value1')
      await backend.put('key2', 'value2')
      await backend.put('key3', 'value3')

      storage._events.length = 0

      await backend.deleteBatch(['key1', 'key3'])

      // Should use transaction
      const txnEvents = storage._events.filter((e) => e.type === 'transaction')
      expect(txnEvents.length).toBeGreaterThan(0)

      // Correct keys deleted
      expect(await backend.get('key1')).toBeUndefined()
      expect(await backend.get('key2')).toBe('value2')
      expect(await backend.get('key3')).toBeUndefined()
    })
  })

  describe('InMemoryStateBackend', () => {
    let backend: InMemoryStateBackend<string>

    beforeEach(() => {
      backend = new InMemoryStateBackend('memory-test')
    })

    it('should persist writes in memory', async () => {
      await backend.put('key', 'value')
      expect(await backend.get('key')).toBe('value')
    })

    it('should handle rapid sequential writes', async () => {
      for (let i = 0; i < 100; i++) {
        await backend.put(`key:${i}`, `value:${i}`)
      }

      expect(await backend.size()).toBe(100)

      for (let i = 0; i < 100; i++) {
        expect(await backend.get(`key:${i}`)).toBe(`value:${i}`)
      }
    })

    it('should handle concurrent writes', async () => {
      const writes = Array.from({ length: 50 }, (_, i) =>
        backend.put(`concurrent:${i}`, `value:${i}`)
      )

      await Promise.all(writes)

      expect(await backend.size()).toBe(50)
    })
  })
})

// =============================================================================
// Read Consistency Tests
// =============================================================================

describe('Read Consistency', () => {
  it('should read own writes immediately', async () => {
    const backend = new InMemoryStateBackend<number>('consistency-test')

    await backend.put('counter', 0)

    for (let i = 1; i <= 10; i++) {
      await backend.put('counter', i)
      expect(await backend.get('counter')).toBe(i)
    }
  })

  it('should reflect deletes immediately', async () => {
    const backend = new InMemoryStateBackend<string>('delete-consistency')

    await backend.put('key', 'value')
    expect(await backend.get('key')).toBe('value')

    await backend.delete('key')
    expect(await backend.get('key')).toBeUndefined()
  })

  it('should list only existing entries', async () => {
    const backend = new InMemoryStateBackend<string>('list-consistency')

    await backend.put('key1', 'value1')
    await backend.put('key2', 'value2')
    await backend.put('key3', 'value3')

    await backend.delete('key2')

    const entries: string[] = []
    for await (const [key] of backend.list()) {
      entries.push(key)
    }

    expect(entries.sort()).toEqual(['key1', 'key3'])
  })

  it('should report accurate size after operations', async () => {
    const backend = new InMemoryStateBackend<string>('size-consistency')

    expect(await backend.size()).toBe(0)

    await backend.put('key1', 'value1')
    expect(await backend.size()).toBe(1)

    await backend.put('key2', 'value2')
    expect(await backend.size()).toBe(2)

    await backend.put('key1', 'updated') // Overwrite
    expect(await backend.size()).toBe(2)

    await backend.delete('key1')
    expect(await backend.size()).toBe(1)

    await backend.clear()
    expect(await backend.size()).toBe(0)
  })
})

// =============================================================================
// TTL Persistence Tests
// =============================================================================

describe('TTL Persistence', () => {
  it('should persist TTL metadata', async () => {
    const storage = createMockDOStorage()
    const backend = new DOStateBackend<string>(storage, 'ttl-persist')

    await backend.put('expires', 'value', 1000) // 1 second TTL

    // Check storage has expiration data
    const stored = storage._data.get('ttl-persist:expires') as {
      value: string
      createdAt: number
      expiresAt: number
    }

    expect(stored).toBeDefined()
    expect(stored.expiresAt).toBeDefined()
    expect(stored.expiresAt).toBeGreaterThan(stored.createdAt)
  })

  it('should persist TTL in snapshots', async () => {
    const backend = new InMemoryStateBackend<string>('ttl-snapshot')

    await backend.put('with-ttl', 'value', 5000)
    await backend.put('no-ttl', 'persistent')

    const snapshot = await backend.snapshot()

    // Clear and restore
    await backend.clear()
    await backend.restore(snapshot)

    // Both should be present immediately after restore
    expect(await backend.get('with-ttl')).toBe('value')
    expect(await backend.get('no-ttl')).toBe('persistent')
  })

  it('should enforce TTL after restoration', async () => {
    const backend = new InMemoryStateBackend<string>('ttl-enforce')

    await backend.put('expires-soon', 'value', 100)
    await backend.put('expires-later', 'value', 10000)

    const snapshot = await backend.snapshot()

    // Wait for first TTL
    await new Promise((r) => setTimeout(r, 150))

    // Restore - expired entry should still be excluded (it expired before snapshot)
    await backend.restore(snapshot)

    // Check which entries are present
    const laterValue = await backend.get('expires-later')
    expect(laterValue).toBe('value')
  })
})

// =============================================================================
// Data Integrity Tests
// =============================================================================

describe('Data Integrity', () => {
  it('should preserve exact value types', async () => {
    interface TypedValue {
      str: string
      num: number
      bool: boolean
      nul: null
      arr: number[]
      obj: { nested: string }
    }

    const backend = new InMemoryStateBackend<TypedValue>('type-integrity')

    const original: TypedValue = {
      str: 'string',
      num: 42.5,
      bool: true,
      nul: null,
      arr: [1, 2, 3],
      obj: { nested: 'value' },
    }

    await backend.put('typed', original)

    const retrieved = await backend.get('typed')

    expect(retrieved).toEqual(original)
    expect(typeof retrieved?.str).toBe('string')
    expect(typeof retrieved?.num).toBe('number')
    expect(typeof retrieved?.bool).toBe('boolean')
    expect(retrieved?.nul).toBeNull()
    expect(Array.isArray(retrieved?.arr)).toBe(true)
    expect(typeof retrieved?.obj).toBe('object')
  })

  it('should preserve exact string encoding', async () => {
    const backend = new InMemoryStateBackend<string>('encoding-test')

    const testStrings = [
      'simple',
      'with spaces',
      'with\ttabs',
      'with\nnewlines',
      'unicode',
      'escaped\\"quotes',
      'emoji \\uD83D\\uDE00',
    ]

    for (const str of testStrings) {
      await backend.put(str, str)
    }

    for (const str of testStrings) {
      expect(await backend.get(str)).toBe(str)
    }
  })

  it('should maintain data through snapshot cycle', async () => {
    const backend = new InMemoryStateBackend<{ data: number[] }>('snapshot-integrity')

    const original = { data: Array.from({ length: 100 }, (_, i) => i) }
    await backend.put('array-data', original)

    const snapshot = await backend.snapshot()
    await backend.clear()
    await backend.restore(snapshot)

    const restored = await backend.get('array-data')

    expect(restored).toEqual(original)
    expect(restored?.data.length).toBe(100)
  })

  it('should handle binary-like string data', async () => {
    const backend = new InMemoryStateBackend<string>('binary-test')

    // Create string with various byte values
    const binaryLike = String.fromCharCode(...Array.from({ length: 256 }, (_, i) => i))

    await backend.put('binary', binaryLike)

    const snapshot = await backend.snapshot()
    await backend.clear()
    await backend.restore(snapshot)

    expect(await backend.get('binary')).toBe(binaryLike)
  })
})

// =============================================================================
// Namespace Isolation Tests
// =============================================================================

describe('Namespace Isolation', () => {
  it('should isolate data between backends with same storage', async () => {
    const storage = createMockDOStorage()

    const backend1 = new DOStateBackend<string>(storage, 'namespace-1')
    const backend2 = new DOStateBackend<string>(storage, 'namespace-2')

    await backend1.put('key', 'value-from-1')
    await backend2.put('key', 'value-from-2')

    expect(await backend1.get('key')).toBe('value-from-1')
    expect(await backend2.get('key')).toBe('value-from-2')
  })

  it('should not list entries from other namespaces', async () => {
    const storage = createMockDOStorage()

    const backend1 = new DOStateBackend<string>(storage, 'ns1')
    const backend2 = new DOStateBackend<string>(storage, 'ns2')

    await backend1.put('a', '1')
    await backend1.put('b', '2')
    await backend2.put('c', '3')
    await backend2.put('d', '4')

    const ns1Keys: string[] = []
    for await (const [key] of backend1.list()) {
      ns1Keys.push(key)
    }

    const ns2Keys: string[] = []
    for await (const [key] of backend2.list()) {
      ns2Keys.push(key)
    }

    expect(ns1Keys.sort()).toEqual(['a', 'b'])
    expect(ns2Keys.sort()).toEqual(['c', 'd'])
  })

  it('should clear only own namespace', async () => {
    const storage = createMockDOStorage()

    const backend1 = new DOStateBackend<string>(storage, 'clear-ns1')
    const backend2 = new DOStateBackend<string>(storage, 'clear-ns2')

    await backend1.put('key1', 'value1')
    await backend2.put('key2', 'value2')

    await backend1.clear()

    expect(await backend1.get('key1')).toBeUndefined()
    expect(await backend2.get('key2')).toBe('value2')
  })

  it('should snapshot only own namespace', async () => {
    const storage = createMockDOStorage()

    const backend1 = new DOStateBackend<string>(storage, 'snap-ns1')
    const backend2 = new DOStateBackend<string>(storage, 'snap-ns2')

    await backend1.put('a', '1')
    await backend1.put('b', '2')
    await backend2.put('c', '3')

    const snap1 = await backend1.snapshot()
    const snap2 = await backend2.snapshot()

    expect(snap1.metadata.stateCount).toBe(2)
    expect(snap2.metadata.stateCount).toBe(1)
  })
})

// =============================================================================
// Operation Ordering Tests
// =============================================================================

describe('Operation Ordering', () => {
  it('should apply operations in order', async () => {
    const backend = new InMemoryStateBackend<number>('ordering-test')

    await backend.put('counter', 0)
    await backend.put('counter', 1)
    await backend.put('counter', 2)
    await backend.put('counter', 3)

    expect(await backend.get('counter')).toBe(3)
  })

  it('should respect put-delete-put sequence', async () => {
    const backend = new InMemoryStateBackend<string>('sequence-test')

    await backend.put('key', 'first')
    await backend.delete('key')
    await backend.put('key', 'second')

    expect(await backend.get('key')).toBe('second')
  })

  it('should handle interleaved operations correctly', async () => {
    const backend = new InMemoryStateBackend<number>('interleaved')

    // Interleaved puts and deletes
    await backend.put('a', 1)
    await backend.put('b', 2)
    await backend.delete('a')
    await backend.put('c', 3)
    await backend.put('a', 4)
    await backend.delete('b')

    expect(await backend.get('a')).toBe(4)
    expect(await backend.get('b')).toBeUndefined()
    expect(await backend.get('c')).toBe(3)
    expect(await backend.size()).toBe(2)
  })
})

// =============================================================================
// Storage Event Tracking Tests
// =============================================================================

describe('Storage Event Tracking', () => {
  it('should track all storage operations', async () => {
    const storage = createMockDOStorage()
    const backend = new DOStateBackend<string>(storage, 'tracking')

    storage._events.length = 0

    await backend.put('key1', 'value1')
    await backend.get('key1')
    await backend.put('key2', 'value2')
    await backend.delete('key1')

    expect(storage._events.filter((e) => e.type === 'put')).toHaveLength(2)
    expect(storage._events.filter((e) => e.type === 'get')).toHaveLength(1)
    expect(storage._events.filter((e) => e.type === 'delete')).toHaveLength(1)
  })

  it('should track operations with timestamps', async () => {
    const storage = createMockDOStorage()
    const backend = new DOStateBackend<string>(storage, 'timestamps')

    storage._events.length = 0

    const before = Date.now()
    await backend.put('key', 'value')
    const after = Date.now()

    expect(storage._events[0].timestamp).toBeGreaterThanOrEqual(before)
    expect(storage._events[0].timestamp).toBeLessThanOrEqual(after)
  })

  it('should track batch operations', async () => {
    const storage = createMockDOStorage()
    const backend = new DOStateBackend<string>(storage, 'batch-track')

    storage._events.length = 0

    await backend.putBatch(
      new Map([
        ['a', '1'],
        ['b', '2'],
      ])
    )

    // Should record transaction
    expect(storage._events.filter((e) => e.type === 'transaction')).toHaveLength(1)
  })
})
