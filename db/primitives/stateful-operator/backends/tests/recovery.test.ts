/**
 * Recovery Tests
 *
 * Tests for state recovery from failures, including checkpoint restoration,
 * partial failure handling, and recovery manager integration.
 *
 * Run with: npx vitest run db/primitives/stateful-operator/backends/tests/recovery.test.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { StateSnapshot, CheckpointStore, CheckpointMetadata } from '../../index'
import { InMemoryStateBackend, StateRecoveryManager } from '../../index'
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
// Mock Checkpoint Store
// =============================================================================

function createMockCheckpointStore(): CheckpointStore & {
  _checkpoints: Map<bigint, CheckpointMetadata>
  _snapshots: Map<string, StateSnapshot>
  addCheckpoint(meta: CheckpointMetadata): void
  addSnapshot(snapshot: StateSnapshot): void
} {
  const checkpoints = new Map<bigint, CheckpointMetadata>()
  const snapshots = new Map<string, StateSnapshot>()

  return {
    _checkpoints: checkpoints,
    _snapshots: snapshots,

    addCheckpoint(meta: CheckpointMetadata) {
      checkpoints.set(meta.checkpointId, meta)
    },

    addSnapshot(snapshot: StateSnapshot) {
      snapshots.set(snapshot.id, snapshot)
    },

    async listCompleted(): Promise<CheckpointMetadata[]> {
      return [...checkpoints.values()].filter((c) => c.status === 'completed')
    },

    async get(checkpointId: bigint): Promise<CheckpointMetadata | undefined> {
      return checkpoints.get(checkpointId)
    },

    async getSnapshot(snapshotId: string): Promise<StateSnapshot> {
      const snapshot = snapshots.get(snapshotId)
      if (!snapshot) {
        throw new Error(`Snapshot not found: ${snapshotId}`)
      }
      return snapshot
    },
  }
}

// =============================================================================
// Recovery from Corruption Tests
// =============================================================================

describe('Recovery from Corruption', () => {
  let backend: InMemoryStateBackend<number>

  beforeEach(() => {
    backend = new InMemoryStateBackend('corruption-test')
  })

  it('should reject snapshot with corrupted checksum', async () => {
    await backend.put('key', 42)
    const snapshot = await backend.snapshot()

    const corrupted: StateSnapshot = {
      ...snapshot,
      metadata: {
        ...snapshot.metadata,
        checksum: 'invalid',
      },
    }

    await expect(backend.restore(corrupted)).rejects.toThrow(/checksum/i)

    // Original state should be intact
    expect(await backend.get('key')).toBe(42)
  })

  it('should reject snapshot with tampered data', async () => {
    await backend.put('key', 42)
    const snapshot = await backend.snapshot()

    // Tamper with the data
    const tamperedData = new Uint8Array([...snapshot.data, 0x00, 0x01, 0x02])

    const corrupted: StateSnapshot = {
      ...snapshot,
      data: tamperedData,
    }

    await expect(backend.restore(corrupted)).rejects.toThrow(/checksum/i)
  })

  it('should reject snapshot with truncated data', async () => {
    await backend.put('key', 42)
    const snapshot = await backend.snapshot()

    // Truncate the data
    const truncatedData = snapshot.data.slice(0, Math.floor(snapshot.data.length / 2))

    const corrupted: StateSnapshot = {
      ...snapshot,
      data: truncatedData,
    }

    await expect(backend.restore(corrupted)).rejects.toThrow()
  })

  it('should maintain state after failed restore attempt', async () => {
    await backend.put('original', 100)
    const goodSnapshot = await backend.snapshot()

    await backend.put('modified', 200)

    // Attempt corrupt restore
    const corruptSnapshot: StateSnapshot = {
      ...goodSnapshot,
      metadata: { ...goodSnapshot.metadata, checksum: 'bad' },
    }

    try {
      await backend.restore(corruptSnapshot)
    } catch {
      // Expected
    }

    // State should still be the modified version
    expect(await backend.get('modified')).toBe(200)
    expect(await backend.get('original')).toBe(100)
  })
})

// =============================================================================
// Recovery Manager Tests
// =============================================================================

describe('StateRecoveryManager', () => {
  it('should find latest checkpoint', async () => {
    const store = createMockCheckpointStore()

    const meta1: CheckpointMetadata = {
      checkpointId: 1n,
      timestamp: 1000,
      operatorStates: new Map(),
      sourceOffsets: new Map(),
      status: 'completed',
    }

    const meta2: CheckpointMetadata = {
      checkpointId: 2n,
      timestamp: 2000,
      operatorStates: new Map(),
      sourceOffsets: new Map(),
      status: 'completed',
    }

    const meta3: CheckpointMetadata = {
      checkpointId: 3n,
      timestamp: 3000,
      operatorStates: new Map(),
      sourceOffsets: new Map(),
      status: 'in_progress', // Not completed
    }

    store.addCheckpoint(meta1)
    store.addCheckpoint(meta2)
    store.addCheckpoint(meta3)

    const manager = new StateRecoveryManager(store, new Map())
    const latest = await manager.findLatestCheckpoint()

    expect(latest).toBeDefined()
    expect(latest!.checkpointId).toBe(2n)
  })

  it('should return undefined when no checkpoints exist', async () => {
    const store = createMockCheckpointStore()
    const manager = new StateRecoveryManager(store, new Map())

    const latest = await manager.findLatestCheckpoint()
    expect(latest).toBeUndefined()
  })

  it('should recover state for all operators', async () => {
    const store = createMockCheckpointStore()

    // Create two backends
    const backend1 = new InMemoryStateBackend<number>('operator1')
    const backend2 = new InMemoryStateBackend<string>('operator2')

    // Put some data and create snapshots
    await backend1.put('counter', 42)
    await backend2.put('status', 'running')

    const snap1 = await backend1.snapshot()
    const snap2 = await backend2.snapshot()

    store.addSnapshot(snap1)
    store.addSnapshot(snap2)

    // Create checkpoint metadata
    const checkpointMeta: CheckpointMetadata = {
      checkpointId: 1n,
      timestamp: Date.now(),
      operatorStates: new Map([
        ['operator1', snap1.id],
        ['operator2', snap2.id],
      ]),
      sourceOffsets: new Map(),
      status: 'completed',
    }

    store.addCheckpoint(checkpointMeta)

    // Modify state after checkpoint
    await backend1.put('counter', 100)
    await backend2.put('status', 'stopped')

    // Create operators map with restoreState
    const operators = new Map([
      ['operator1', { restoreState: (s: StateSnapshot) => backend1.restore(s) }],
      ['operator2', { restoreState: (s: StateSnapshot) => backend2.restore(s) }],
    ])

    const manager = new StateRecoveryManager(store, operators)
    await manager.recover()

    // State should be restored to checkpoint
    expect(await backend1.get('counter')).toBe(42)
    expect(await backend2.get('status')).toBe('running')
  })

  it('should recover to specific checkpoint', async () => {
    const store = createMockCheckpointStore()
    const backend = new InMemoryStateBackend<number>('operator')

    // Checkpoint 1
    await backend.put('value', 10)
    const snap1 = await backend.snapshot()
    store.addSnapshot(snap1)

    const meta1: CheckpointMetadata = {
      checkpointId: 1n,
      timestamp: 1000,
      operatorStates: new Map([['operator', snap1.id]]),
      sourceOffsets: new Map(),
      status: 'completed',
    }
    store.addCheckpoint(meta1)

    // Checkpoint 2
    await backend.put('value', 20)
    const snap2 = await backend.snapshot()
    store.addSnapshot(snap2)

    const meta2: CheckpointMetadata = {
      checkpointId: 2n,
      timestamp: 2000,
      operatorStates: new Map([['operator', snap2.id]]),
      sourceOffsets: new Map(),
      status: 'completed',
    }
    store.addCheckpoint(meta2)

    // Current state
    await backend.put('value', 30)

    const operators = new Map([
      ['operator', { restoreState: (s: StateSnapshot) => backend.restore(s) }],
    ])

    const manager = new StateRecoveryManager(store, operators)

    // Recover to specific checkpoint
    await manager.recover(1n)
    expect(await backend.get('value')).toBe(10)

    await manager.recover(2n)
    expect(await backend.get('value')).toBe(20)
  })

  it('should throw when no checkpoint available', async () => {
    const store = createMockCheckpointStore()
    const manager = new StateRecoveryManager(store, new Map())

    await expect(manager.recover()).rejects.toThrow(/no checkpoint available/i)
  })

  it('should skip operators not in checkpoint', async () => {
    const store = createMockCheckpointStore()

    const backend = new InMemoryStateBackend<number>('known-operator')
    await backend.put('data', 42)
    const snapshot = await backend.snapshot()
    store.addSnapshot(snapshot)

    const checkpointMeta: CheckpointMetadata = {
      checkpointId: 1n,
      timestamp: Date.now(),
      operatorStates: new Map([['known-operator', snapshot.id]]),
      sourceOffsets: new Map(),
      status: 'completed',
    }
    store.addCheckpoint(checkpointMeta)

    // Register an unknown operator
    const unknownBackend = new InMemoryStateBackend<string>('unknown-operator')
    await unknownBackend.put('other', 'value')

    const operators = new Map([
      ['known-operator', { restoreState: (s: StateSnapshot) => backend.restore(s) }],
      ['unknown-operator', { restoreState: (s: StateSnapshot) => unknownBackend.restore(s) }],
    ])

    const manager = new StateRecoveryManager(store, operators)

    // Should not throw, just skip unknown operator
    await expect(manager.recover()).resolves.not.toThrow()

    // Known operator should be restored
    expect(await backend.get('data')).toBe(42)

    // Unknown operator should be unaffected
    expect(await unknownBackend.get('other')).toBe('value')
  })
})

// =============================================================================
// Failure Simulation Tests
// =============================================================================

describe('Failure Simulation', () => {
  it('should recover after simulated crash during processing', async () => {
    const storage = createMockDOStorage()
    const backend = new DOStateBackend<number>(storage, 'crash-test')

    // Process some events
    await backend.put('event:1', 100)
    await backend.put('event:2', 200)
    const checkpoint = await backend.snapshot()

    // Simulate more processing
    await backend.put('event:3', 300)
    await backend.put('event:4', 400)

    // Simulate crash - clear the backend
    await backend.clear()

    // Recover from checkpoint
    await backend.restore(checkpoint)

    // State should be at checkpoint
    expect(await backend.get('event:1')).toBe(100)
    expect(await backend.get('event:2')).toBe(200)
    expect(await backend.get('event:3')).toBeUndefined()
    expect(await backend.get('event:4')).toBeUndefined()
  })

  it('should handle multiple recovery attempts', async () => {
    const backend = new InMemoryStateBackend<string>('multi-recovery')

    await backend.put('state', 'initial')
    const checkpoint = await backend.snapshot()

    // First crash and recovery
    await backend.put('state', 'modified1')
    await backend.restore(checkpoint)
    expect(await backend.get('state')).toBe('initial')

    // Second crash and recovery
    await backend.put('state', 'modified2')
    await backend.restore(checkpoint)
    expect(await backend.get('state')).toBe('initial')

    // Third crash and recovery
    await backend.put('state', 'modified3')
    await backend.delete('state')
    await backend.restore(checkpoint)
    expect(await backend.get('state')).toBe('initial')
  })

  it('should recover partial updates correctly', async () => {
    const backend = new InMemoryStateBackend<number>('partial-update')

    // Initial state with multiple keys
    for (let i = 0; i < 10; i++) {
      await backend.put(`key:${i}`, i * 10)
    }
    const checkpoint = await backend.snapshot()

    // Partial update - only modify some keys
    await backend.put('key:0', 999)
    await backend.put('key:5', 999)
    await backend.delete('key:9')

    // Recover
    await backend.restore(checkpoint)

    // All keys should be at checkpoint values
    for (let i = 0; i < 10; i++) {
      expect(await backend.get(`key:${i}`)).toBe(i * 10)
    }
  })
})

// =============================================================================
// Recovery Consistency Tests
// =============================================================================

describe('Recovery Consistency', () => {
  it('should maintain referential integrity after recovery', async () => {
    interface User {
      id: string
      name: string
      orderIds: string[]
    }

    interface Order {
      id: string
      userId: string
      total: number
    }

    const userBackend = new InMemoryStateBackend<User>('users')
    const orderBackend = new InMemoryStateBackend<Order>('orders')

    // Create related data
    await userBackend.put('user:1', {
      id: 'user:1',
      name: 'Alice',
      orderIds: ['order:1', 'order:2'],
    })

    await orderBackend.put('order:1', { id: 'order:1', userId: 'user:1', total: 100 })
    await orderBackend.put('order:2', { id: 'order:2', userId: 'user:1', total: 200 })

    // Checkpoint both
    const userSnapshot = await userBackend.snapshot()
    const orderSnapshot = await orderBackend.snapshot()

    // Modify both
    await userBackend.put('user:1', {
      id: 'user:1',
      name: 'Alice Updated',
      orderIds: ['order:1', 'order:2', 'order:3'],
    })
    await orderBackend.put('order:3', { id: 'order:3', userId: 'user:1', total: 300 })

    // Restore both
    await userBackend.restore(userSnapshot)
    await orderBackend.restore(orderSnapshot)

    // Verify referential integrity
    const user = await userBackend.get('user:1')
    expect(user?.orderIds).toEqual(['order:1', 'order:2'])

    // All referenced orders should exist
    for (const orderId of user!.orderIds) {
      const order = await orderBackend.get(orderId)
      expect(order).toBeDefined()
      expect(order?.userId).toBe('user:1')
    }

    // order:3 should not exist
    expect(await orderBackend.get('order:3')).toBeUndefined()
  })

  it('should recover counters to exact checkpoint value', async () => {
    const backend = new InMemoryStateBackend<number>('counters')

    // Initialize counter
    await backend.put('counter', 0)

    // Increment and checkpoint at specific points
    const checkpoints: StateSnapshot[] = []

    for (let i = 1; i <= 5; i++) {
      await backend.put('counter', i * 10)
      checkpoints.push(await backend.snapshot())
    }

    // Verify each checkpoint restores to exact value
    for (let i = 0; i < checkpoints.length; i++) {
      await backend.restore(checkpoints[i])
      expect(await backend.get('counter')).toBe((i + 1) * 10)
    }
  })

  it('should handle concurrent operations during recovery', async () => {
    const backend = new InMemoryStateBackend<number>('concurrent-recovery')

    await backend.put('counter', 100)
    const checkpoint = await backend.snapshot()

    await backend.put('counter', 200)

    // Simulate concurrent operations - snapshot and modifications
    const [restored] = await Promise.all([
      backend.restore(checkpoint),
      // These should either complete before restore or be lost
      backend.put('temp', 999).catch(() => {}),
    ])

    // After restore, state should match checkpoint
    expect(await backend.get('counter')).toBe(100)
  })
})

// =============================================================================
// DO Backend Specific Recovery Tests
// =============================================================================

describe('DOStateBackend Recovery', () => {
  it('should recover with transactional guarantees', async () => {
    const storage = createMockDOStorage()
    const backend = new DOStateBackend<string>(storage, 'txn-recovery', {
      transactional: true,
    })

    await backend.put('key1', 'value1')
    await backend.put('key2', 'value2')
    const checkpoint = await backend.snapshot()

    await backend.put('key1', 'modified')
    await backend.put('key3', 'new-value')

    await backend.restore(checkpoint)

    expect(await backend.get('key1')).toBe('value1')
    expect(await backend.get('key2')).toBe('value2')
    expect(await backend.get('key3')).toBeUndefined()
  })

  it('should recover with large batch size correctly', async () => {
    const storage = createMockDOStorage()
    const backend = new DOStateBackend<number>(storage, 'batch-recovery', {
      listBatchSize: 10,
    })

    // Create more entries than batch size
    for (let i = 0; i < 50; i++) {
      await backend.put(`key:${i}`, i)
    }

    const checkpoint = await backend.snapshot()

    // Modify all entries
    for (let i = 0; i < 50; i++) {
      await backend.put(`key:${i}`, i * 100)
    }

    await backend.restore(checkpoint)

    // Verify all entries restored correctly
    for (let i = 0; i < 50; i++) {
      expect(await backend.get(`key:${i}`)).toBe(i)
    }
  })

  it('should cleanup expired entries and recover correctly', async () => {
    const storage = createMockDOStorage()
    const backend = new DOStateBackend<string>(storage, 'ttl-recovery')

    // Put with short TTL
    await backend.put('expires', 'temp', 50)
    await backend.put('persists', 'permanent')

    // Wait for expiration
    await new Promise((r) => setTimeout(r, 100))

    // Cleanup
    const cleaned = await backend.cleanup()
    expect(cleaned).toBe(1)

    // Snapshot should only include non-expired
    const checkpoint = await backend.snapshot()
    expect(checkpoint.metadata.stateCount).toBe(1)

    await backend.clear()
    await backend.restore(checkpoint)

    expect(await backend.get('expires')).toBeUndefined()
    expect(await backend.get('persists')).toBe('permanent')
  })
})
