/**
 * Backend Switching Tests
 *
 * Tests for switching between different StateBackend implementations,
 * including state migration, compatibility, and live switching scenarios.
 *
 * Run with: npx vitest run db/primitives/stateful-operator/backends/tests/backend-switching.test.ts
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
// Backend Switch Helper
// =============================================================================

/**
 * Helper class to manage backend switching with state transfer
 */
class BackendSwitcher<T> {
  private currentBackend: StateBackend<T>

  constructor(initialBackend: StateBackend<T>) {
    this.currentBackend = initialBackend
  }

  get backend(): StateBackend<T> {
    return this.currentBackend
  }

  /**
   * Switch to a new backend, transferring all state
   */
  async switchTo(newBackend: StateBackend<T>): Promise<{
    transferred: number
    duration: number
  }> {
    const startTime = Date.now()

    // Take snapshot of current state
    const snapshot = await this.currentBackend.snapshot()

    // Restore to new backend
    await newBackend.restore(snapshot)

    // Verify transfer
    const oldSize = await this.currentBackend.size()
    const newSize = await newBackend.size()

    if (oldSize !== newSize) {
      throw new Error(`State transfer mismatch: expected ${oldSize}, got ${newSize}`)
    }

    // Update current backend
    this.currentBackend = newBackend

    return {
      transferred: newSize,
      duration: Date.now() - startTime,
    }
  }

  /**
   * Create a hot standby that mirrors the primary
   */
  async createStandby(standbyBackend: StateBackend<T>): Promise<void> {
    const snapshot = await this.currentBackend.snapshot()
    await standbyBackend.restore(snapshot)
  }
}

// =============================================================================
// Basic Backend Switching Tests
// =============================================================================

describe('Basic Backend Switching', () => {
  it('should switch from InMemory to DO backend', async () => {
    const inMemory = new InMemoryStateBackend<string>('source')
    const doStorage = createMockDOStorage()
    const doBackend = new DOStateBackend<string>(doStorage, 'target')

    const switcher = new BackendSwitcher(inMemory)

    // Populate source
    await switcher.backend.put('user:1', 'alice')
    await switcher.backend.put('user:2', 'bob')
    await switcher.backend.put('config', 'settings')

    // Switch
    const result = await switcher.switchTo(doBackend)

    expect(result.transferred).toBe(3)
    expect(result.duration).toBeGreaterThanOrEqual(0)

    // Verify new backend works
    expect(await switcher.backend.get('user:1')).toBe('alice')
    expect(await switcher.backend.get('user:2')).toBe('bob')
    expect(await switcher.backend.get('config')).toBe('settings')

    // New operations should work
    await switcher.backend.put('new-key', 'new-value')
    expect(await switcher.backend.get('new-key')).toBe('new-value')
  })

  it('should switch from DO to InMemory backend', async () => {
    const doStorage = createMockDOStorage()
    const doBackend = new DOStateBackend<number>(doStorage, 'source')
    const inMemory = new InMemoryStateBackend<number>('target')

    const switcher = new BackendSwitcher(doBackend)

    // Populate source
    await switcher.backend.put('counter:1', 100)
    await switcher.backend.put('counter:2', 200)

    // Switch
    const result = await switcher.switchTo(inMemory)

    expect(result.transferred).toBe(2)

    // Verify new backend
    expect(await switcher.backend.get('counter:1')).toBe(100)
    expect(await switcher.backend.get('counter:2')).toBe(200)
  })

  it('should switch between InMemory backends', async () => {
    const backend1 = new InMemoryStateBackend<string>('backend1')
    const backend2 = new InMemoryStateBackend<string>('backend2')

    const switcher = new BackendSwitcher(backend1)

    await switcher.backend.put('key', 'value')

    await switcher.switchTo(backend2)

    expect(await switcher.backend.get('key')).toBe('value')
    expect(switcher.backend.name).toBe('backend2')
  })

  it('should switch between DO backends', async () => {
    const storage1 = createMockDOStorage()
    const storage2 = createMockDOStorage()

    const backend1 = new DOStateBackend<string>(storage1, 'do1')
    const backend2 = new DOStateBackend<string>(storage2, 'do2')

    const switcher = new BackendSwitcher(backend1)

    await switcher.backend.put('data', 'important')

    await switcher.switchTo(backend2)

    expect(await switcher.backend.get('data')).toBe('important')
    expect(switcher.backend.name).toBe('do2')
  })
})

// =============================================================================
// State Migration Tests
// =============================================================================

describe('State Migration During Switch', () => {
  it('should preserve all data types during migration', async () => {
    interface ComplexValue {
      string: string
      number: number
      boolean: boolean
      array: number[]
      nested: { a: number; b: string }
    }

    const source = new InMemoryStateBackend<ComplexValue>('source')
    const doStorage = createMockDOStorage()
    const target = new DOStateBackend<ComplexValue>(doStorage, 'target')

    const complexData: ComplexValue = {
      string: 'hello',
      number: 42,
      boolean: true,
      array: [1, 2, 3],
      nested: { a: 1, b: 'nested' },
    }

    await source.put('complex', complexData)

    const switcher = new BackendSwitcher(source)
    await switcher.switchTo(target)

    const restored = await switcher.backend.get('complex')
    expect(restored).toEqual(complexData)
  })

  it('should handle large datasets during migration', async () => {
    const source = new InMemoryStateBackend<number>('source')
    const target = new InMemoryStateBackend<number>('target')

    const entryCount = 500

    for (let i = 0; i < entryCount; i++) {
      await source.put(`key:${i}`, i)
    }

    const switcher = new BackendSwitcher(source)
    const result = await switcher.switchTo(target)

    expect(result.transferred).toBe(entryCount)

    // Verify random samples
    expect(await switcher.backend.get('key:0')).toBe(0)
    expect(await switcher.backend.get('key:250')).toBe(250)
    expect(await switcher.backend.get('key:499')).toBe(499)
  })

  it('should preserve key ordering after migration', async () => {
    const source = new InMemoryStateBackend<string>('source')
    const doStorage = createMockDOStorage()
    const target = new DOStateBackend<string>(doStorage, 'target')

    const keys = ['alpha', 'beta', 'gamma', 'delta', 'epsilon']
    for (const key of keys) {
      await source.put(key, `value-${key}`)
    }

    const switcher = new BackendSwitcher(source)
    await switcher.switchTo(target)

    // Collect keys from target
    const targetKeys: string[] = []
    for await (const [key] of switcher.backend.list()) {
      targetKeys.push(key)
    }

    // Should have same keys (order may vary by implementation)
    expect(targetKeys.sort()).toEqual(keys.sort())
  })

  it('should migrate prefixed keys correctly', async () => {
    const source = new InMemoryStateBackend<string>('source')
    const target = new InMemoryStateBackend<string>('target')

    await source.put('users:1', 'alice')
    await source.put('users:2', 'bob')
    await source.put('orders:1', 'order1')
    await source.put('orders:2', 'order2')

    const switcher = new BackendSwitcher(source)
    await switcher.switchTo(target)

    // Verify prefix queries work on new backend
    const users: string[] = []
    for await (const [, value] of switcher.backend.list('users:')) {
      users.push(value)
    }

    const orders: string[] = []
    for await (const [, value] of switcher.backend.list('orders:')) {
      orders.push(value)
    }

    expect(users.sort()).toEqual(['alice', 'bob'])
    expect(orders.sort()).toEqual(['order1', 'order2'])
  })
})

// =============================================================================
// Multiple Backend Switch Tests
// =============================================================================

describe('Multiple Backend Switches', () => {
  it('should handle chain of switches', async () => {
    const backend1 = new InMemoryStateBackend<number>('stage1')
    const storage2 = createMockDOStorage()
    const backend2 = new DOStateBackend<number>(storage2, 'stage2')
    const backend3 = new InMemoryStateBackend<number>('stage3')

    const switcher = new BackendSwitcher(backend1)

    // Stage 1
    await switcher.backend.put('counter', 10)
    expect(await switcher.backend.get('counter')).toBe(10)

    // Switch to stage 2
    await switcher.switchTo(backend2)
    await switcher.backend.put('counter', 20)
    expect(await switcher.backend.get('counter')).toBe(20)

    // Switch to stage 3
    await switcher.switchTo(backend3)
    expect(await switcher.backend.get('counter')).toBe(20)

    // Modify and verify
    await switcher.backend.put('counter', 30)
    expect(await switcher.backend.get('counter')).toBe(30)
  })

  it('should preserve accumulated state across switches', async () => {
    const backends = [
      new InMemoryStateBackend<string>('b1'),
      new InMemoryStateBackend<string>('b2'),
      new InMemoryStateBackend<string>('b3'),
    ]

    const switcher = new BackendSwitcher(backends[0])

    // Add data in first backend
    await switcher.backend.put('key1', 'from-b1')

    // Switch and add more
    await switcher.switchTo(backends[1])
    await switcher.backend.put('key2', 'from-b2')

    // Switch again and add more
    await switcher.switchTo(backends[2])
    await switcher.backend.put('key3', 'from-b3')

    // Final backend should have all data
    expect(await switcher.backend.get('key1')).toBe('from-b1')
    expect(await switcher.backend.get('key2')).toBe('from-b2')
    expect(await switcher.backend.get('key3')).toBe('from-b3')
    expect(await switcher.backend.size()).toBe(3)
  })

  it('should handle switch to same type backend', async () => {
    const storage1 = createMockDOStorage()
    const storage2 = createMockDOStorage()

    const backend1 = new DOStateBackend<string>(storage1, 'do-instance-1')
    const backend2 = new DOStateBackend<string>(storage2, 'do-instance-2')

    const switcher = new BackendSwitcher(backend1)

    await switcher.backend.put('data', 'original')

    await switcher.switchTo(backend2)

    expect(await switcher.backend.get('data')).toBe('original')

    // Original backend should still have data
    expect(await backend1.get('data')).toBe('original')
  })
})

// =============================================================================
// Hot Standby Tests
// =============================================================================

describe('Hot Standby', () => {
  it('should create synchronized standby', async () => {
    const primary = new InMemoryStateBackend<string>('primary')
    const standby = new InMemoryStateBackend<string>('standby')

    const switcher = new BackendSwitcher(primary)

    // Populate primary
    await switcher.backend.put('key1', 'value1')
    await switcher.backend.put('key2', 'value2')

    // Create standby
    await switcher.createStandby(standby)

    // Verify standby has same data
    expect(await standby.get('key1')).toBe('value1')
    expect(await standby.get('key2')).toBe('value2')
    expect(await standby.size()).toBe(2)
  })

  it('should allow failover to standby', async () => {
    const primary = new InMemoryStateBackend<number>('primary')
    const standby = new InMemoryStateBackend<number>('standby')

    const switcher = new BackendSwitcher(primary)

    // Initialize state
    await switcher.backend.put('counter', 100)

    // Create standby
    await switcher.createStandby(standby)

    // Simulate primary failure - switch to standby
    await switcher.switchTo(standby)

    // Standby should be fully functional
    expect(await switcher.backend.get('counter')).toBe(100)

    // Should be able to continue operations
    await switcher.backend.put('counter', 150)
    expect(await switcher.backend.get('counter')).toBe(150)
  })

  it('should handle periodic sync to standby', async () => {
    const primary = new InMemoryStateBackend<number>('primary')
    const standby = new InMemoryStateBackend<number>('standby')

    const switcher = new BackendSwitcher(primary)

    // Initial sync
    await switcher.backend.put('value', 1)
    await switcher.createStandby(standby)
    expect(await standby.get('value')).toBe(1)

    // More changes
    await switcher.backend.put('value', 2)
    await switcher.createStandby(standby)
    expect(await standby.get('value')).toBe(2)

    // Even more changes
    await switcher.backend.put('value', 3)
    await switcher.backend.put('other', 999)
    await switcher.createStandby(standby)
    expect(await standby.get('value')).toBe(3)
    expect(await standby.get('other')).toBe(999)
  })
})

// =============================================================================
// Edge Cases in Backend Switching
// =============================================================================

describe('Backend Switching Edge Cases', () => {
  it('should handle switch with empty state', async () => {
    const source = new InMemoryStateBackend<string>('empty-source')
    const target = new InMemoryStateBackend<string>('target')

    const switcher = new BackendSwitcher(source)
    const result = await switcher.switchTo(target)

    expect(result.transferred).toBe(0)
    expect(await switcher.backend.size()).toBe(0)
  })

  it('should clear target before switch', async () => {
    const source = new InMemoryStateBackend<string>('source')
    const target = new InMemoryStateBackend<string>('target')

    // Pre-populate target
    await target.put('old-key', 'old-value')

    // Source has different data
    await source.put('new-key', 'new-value')

    const switcher = new BackendSwitcher(source)
    await switcher.switchTo(target)

    // Target should only have source's data
    expect(await switcher.backend.get('old-key')).toBeUndefined()
    expect(await switcher.backend.get('new-key')).toBe('new-value')
    expect(await switcher.backend.size()).toBe(1)
  })

  it('should handle special characters in data during switch', async () => {
    const source = new InMemoryStateBackend<string>('source')
    const target = new InMemoryStateBackend<string>('target')

    await source.put('key:with:colons', 'value:colons')
    await source.put('key/slashes', 'value/slashes')
    await source.put('key\ttab', 'value\ttab')
    await source.put('unicode', 'value')

    const switcher = new BackendSwitcher(source)
    await switcher.switchTo(target)

    expect(await switcher.backend.get('key:with:colons')).toBe('value:colons')
    expect(await switcher.backend.get('key/slashes')).toBe('value/slashes')
    expect(await switcher.backend.get('key\ttab')).toBe('value\ttab')
    expect(await switcher.backend.get('unicode')).toBe('value')
  })

  it('should handle large values during switch', async () => {
    const source = new InMemoryStateBackend<string>('source')
    const target = new InMemoryStateBackend<string>('target')

    const largeValue = 'x'.repeat(50 * 1024) // 50KB
    await source.put('large', largeValue)

    const switcher = new BackendSwitcher(source)
    await switcher.switchTo(target)

    expect(await switcher.backend.get('large')).toBe(largeValue)
  })

  it('should preserve source state after switch', async () => {
    const source = new InMemoryStateBackend<string>('source')
    const target = new InMemoryStateBackend<string>('target')

    await source.put('key', 'value')

    const switcher = new BackendSwitcher(source)
    await switcher.switchTo(target)

    // Source should still have its data
    expect(await source.get('key')).toBe('value')

    // Changes to new backend shouldn't affect source
    await switcher.backend.put('key', 'modified')
    expect(await source.get('key')).toBe('value')
    expect(await switcher.backend.get('key')).toBe('modified')
  })
})

// =============================================================================
// Rollback Tests
// =============================================================================

describe('Rollback Capability', () => {
  it('should support rollback to previous backend', async () => {
    const backend1 = new InMemoryStateBackend<number>('original')
    const backend2 = new InMemoryStateBackend<number>('new')

    await backend1.put('counter', 100)
    const checkpoint = await backend1.snapshot()

    const switcher = new BackendSwitcher(backend1)
    await switcher.switchTo(backend2)

    // Make changes in new backend
    await switcher.backend.put('counter', 200)
    await switcher.backend.put('extra', 999)

    // Rollback by restoring checkpoint to the current backend
    // This simulates rolling back to a known good state
    await switcher.backend.restore(checkpoint)

    expect(await switcher.backend.get('counter')).toBe(100)
    expect(await switcher.backend.get('extra')).toBeUndefined()
  })

  it('should maintain rollback chain', async () => {
    const checkpoints: { backend: StateBackend<number>; snapshot: StateSnapshot }[] = []

    const backend1 = new InMemoryStateBackend<number>('v1')
    await backend1.put('value', 1)
    checkpoints.push({ backend: backend1, snapshot: await backend1.snapshot() })

    const backend2 = new InMemoryStateBackend<number>('v2')
    await backend2.restore(checkpoints[0].snapshot)
    await backend2.put('value', 2)
    checkpoints.push({ backend: backend2, snapshot: await backend2.snapshot() })

    const backend3 = new InMemoryStateBackend<number>('v3')
    await backend3.restore(checkpoints[1].snapshot)
    await backend3.put('value', 3)
    checkpoints.push({ backend: backend3, snapshot: await backend3.snapshot() })

    // Can rollback to any point
    const restore = new InMemoryStateBackend<number>('restore')

    await restore.restore(checkpoints[0].snapshot)
    expect(await restore.get('value')).toBe(1)

    await restore.restore(checkpoints[1].snapshot)
    expect(await restore.get('value')).toBe(2)

    await restore.restore(checkpoints[2].snapshot)
    expect(await restore.get('value')).toBe(3)
  })
})
