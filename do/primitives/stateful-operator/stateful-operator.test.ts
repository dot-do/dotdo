/**
 * StatefulOperator - Flink-style stream state management tests
 *
 * TDD RED phase: These tests define the expected behavior for:
 * - StateBackend: Abstract interface for state storage
 * - KeyedState: State partitioned by key (ValueState, ListState, MapState)
 * - WindowState: Time-based aggregation windows
 * - CheckpointBarrier: Distributed snapshot coordination
 * - DOStateBackend: Durable Object implementation
 * - R2StateBackend: R2 blob storage for large state
 * - StateTTL: Time-to-live state cleanup
 * - StateRecovery: Restore from checkpoints
 * - StateMetrics: Observability
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  // Core types
  type StateBackend,
  type StateSnapshot,
  type StateDescriptor,
  type StateTTLConfig,
  type StateAccess,
  type StateEntry,
  // KeyedState
  type KeyedState,
  type Partitioner,
  HashPartitioner,
  RangePartitioner,
  createKeyedState,
  // WindowState
  type WindowState,
  type WindowKey,
  type WindowAssigner,
  TumblingWindowAssigner,
  SlidingWindowAssigner,
  SessionWindowAssigner,
  createWindowState,
  // CheckpointBarrier
  type CheckpointBarrier,
  type CheckpointOptions,
  type CheckpointResult,
  BarrierAligner,
  CheckpointCoordinator,
  // Backends
  InMemoryStateBackend,
  // DOStateBackend,
  // R2StateBackend,
  // TTL
  type TTLPolicy,
  type CleanupStrategy,
  type CleanupResult,
  TTLStateWrapper,
  // Recovery
  type CheckpointMetadata,
  type CheckpointStore,
  StateRecoveryManager,
  // Metrics
  type StateMetrics,
  type MetricsRegistry,
  MetricsStateWrapper,
  createStateMetrics,
} from './index'

// =============================================================================
// StateBackend Interface Tests
// =============================================================================

describe('StateBackend', () => {
  let backend: StateBackend<string>

  beforeEach(() => {
    backend = new InMemoryStateBackend<string>('test-state')
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
  })

  describe('snapshot and restore', () => {
    it('should create a snapshot with metadata', async () => {
      await backend.put('key1', 'value1')
      await backend.put('key2', 'value2')

      const snapshot = await backend.snapshot()

      expect(snapshot.id).toBeDefined()
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
  })

  describe('TTL support', () => {
    it('should support TTL on put', async () => {
      await backend.put('key1', 'value1', 100) // 100ms TTL

      expect(await backend.get('key1')).toBe('value1')

      // Wait for TTL to expire
      await new Promise((r) => setTimeout(r, 150))

      expect(await backend.get('key1')).toBeUndefined()
    })
  })
})

// =============================================================================
// KeyedState Tests
// =============================================================================

describe('KeyedState', () => {
  let backend: StateBackend<number>
  let keyedState: KeyedState<string, number>

  beforeEach(() => {
    backend = new InMemoryStateBackend<number>('keyed-state')
    keyedState = createKeyedState(backend)
  })

  describe('basic operations', () => {
    it('should get undefined for non-existent key', async () => {
      const value = await keyedState.get('missing')
      expect(value).toBeUndefined()
    })

    it('should put and get values', async () => {
      await keyedState.put('user:1', 100)
      expect(await keyedState.get('user:1')).toBe(100)
    })

    it('should delete values', async () => {
      await keyedState.put('user:1', 100)
      await keyedState.delete('user:1')
      expect(await keyedState.get('user:1')).toBeUndefined()
    })
  })

  describe('update operation', () => {
    it('should update existing value', async () => {
      await keyedState.put('counter', 10)
      const newValue = await keyedState.update('counter', (v) => (v ?? 0) + 1)
      expect(newValue).toBe(11)
      expect(await keyedState.get('counter')).toBe(11)
    })

    it('should initialize with update function for missing key', async () => {
      const value = await keyedState.update('counter', (v) => (v ?? 0) + 5)
      expect(value).toBe(5)
    })
  })

  describe('keys iteration', () => {
    it('should iterate all keys', async () => {
      await keyedState.put('a', 1)
      await keyedState.put('b', 2)
      await keyedState.put('c', 3)

      const keys: string[] = []
      for await (const key of keyedState.keys()) {
        keys.push(key)
      }

      expect(keys.sort()).toEqual(['a', 'b', 'c'])
    })
  })

  describe('clear operation', () => {
    it('should clear all entries', async () => {
      await keyedState.put('a', 1)
      await keyedState.put('b', 2)
      await keyedState.clear()

      expect(await keyedState.get('a')).toBeUndefined()
      expect(await keyedState.get('b')).toBeUndefined()
    })
  })
})

describe('Partitioner', () => {
  describe('HashPartitioner', () => {
    it('should distribute keys across partitions', () => {
      const partitioner = new HashPartitioner<string>(4)

      const partitions = new Set<number>()
      for (let i = 0; i < 100; i++) {
        partitions.add(partitioner.partition(`key-${i}`))
      }

      // Should use multiple partitions
      expect(partitions.size).toBeGreaterThan(1)

      // All partitions should be in range
      for (const p of partitions) {
        expect(p).toBeGreaterThanOrEqual(0)
        expect(p).toBeLessThan(4)
      }
    })

    it('should be deterministic', () => {
      const partitioner = new HashPartitioner<string>(8)

      const p1 = partitioner.partition('test-key')
      const p2 = partitioner.partition('test-key')

      expect(p1).toBe(p2)
    })
  })

  describe('RangePartitioner', () => {
    it('should partition by key ranges', () => {
      const boundaries = ['d', 'h', 'm', 's']
      const partitioner = new RangePartitioner<string>(boundaries)

      expect(partitioner.partition('apple')).toBe(0) // < 'd'
      expect(partitioner.partition('dog')).toBe(1) // >= 'd', < 'h'
      expect(partitioner.partition('hello')).toBe(2) // >= 'h', < 'm'
      expect(partitioner.partition('monkey')).toBe(3) // >= 'm', < 's'
      expect(partitioner.partition('zebra')).toBe(4) // >= 's'
    })

    it('should return correct numPartitions', () => {
      const boundaries = ['d', 'h', 'm']
      const partitioner = new RangePartitioner<string>(boundaries)
      expect(partitioner.numPartitions).toBe(4) // boundaries + 1
    })
  })
})

// =============================================================================
// WindowState Tests
// =============================================================================

describe('WindowState', () => {
  let backend: StateBackend<number[]>
  let windowState: WindowState<number[]>

  beforeEach(() => {
    backend = new InMemoryStateBackend<number[]>('window-state')
    windowState = createWindowState(backend, new TumblingWindowAssigner(60000)) // 1 minute windows
  })

  describe('window operations', () => {
    it('should get undefined for non-existent window', async () => {
      const value = await windowState.getWindow('key1', 0, 60000)
      expect(value).toBeUndefined()
    })

    it('should update window state', async () => {
      const result = await windowState.updateWindow('key1', 0, 60000, (v) => [...(v ?? []), 1])
      expect(result).toEqual([1])

      const result2 = await windowState.updateWindow('key1', 0, 60000, (v) => [...(v ?? []), 2])
      expect(result2).toEqual([1, 2])
    })

    it('should manage multiple windows for same key', async () => {
      await windowState.updateWindow('key1', 0, 60000, () => [1])
      await windowState.updateWindow('key1', 60000, 120000, () => [2])

      expect(await windowState.getWindow('key1', 0, 60000)).toEqual([1])
      expect(await windowState.getWindow('key1', 60000, 120000)).toEqual([2])
    })
  })

  describe('window expiration', () => {
    it('should expire windows before watermark', async () => {
      await windowState.updateWindow('key1', 0, 60000, () => [1])
      await windowState.updateWindow('key1', 60000, 120000, () => [2])
      await windowState.updateWindow('key1', 120000, 180000, () => [3])

      const expired = await windowState.expireWindows(120000)
      expect(expired).toBe(1) // First window expired

      expect(await windowState.getWindow('key1', 0, 60000)).toBeUndefined()
      expect(await windowState.getWindow('key1', 60000, 120000)).toEqual([2])
    })
  })

  describe('active windows', () => {
    it('should iterate active windows for a key', async () => {
      await windowState.updateWindow('key1', 0, 60000, () => [1])
      await windowState.updateWindow('key1', 60000, 120000, () => [2])
      await windowState.updateWindow('key2', 0, 60000, () => [3])

      const windows: WindowKey[] = []
      for await (const w of windowState.activeWindows('key1')) {
        windows.push(w)
      }

      expect(windows).toHaveLength(2)
      expect(windows.every((w) => w.key === 'key1')).toBe(true)
    })
  })
})

describe('WindowAssigner', () => {
  describe('TumblingWindowAssigner', () => {
    it('should assign to non-overlapping windows', () => {
      const assigner = new TumblingWindowAssigner(60000) // 1 minute

      const windows1 = assigner.assignWindows(1000) // t=1s
      const windows2 = assigner.assignWindows(61000) // t=61s

      expect(windows1).toHaveLength(1)
      expect(windows1[0]).toEqual({ start: 0, end: 60000 })

      expect(windows2).toHaveLength(1)
      expect(windows2[0]).toEqual({ start: 60000, end: 120000 })
    })
  })

  describe('SlidingWindowAssigner', () => {
    it('should assign to overlapping windows', () => {
      const assigner = new SlidingWindowAssigner(60000, 30000) // 1 min size, 30s slide

      const windows = assigner.assignWindows(45000) // t=45s

      // Should be in two windows: [0, 60000) and [30000, 90000)
      expect(windows).toHaveLength(2)
      expect(windows).toContainEqual({ start: 0, end: 60000 })
      expect(windows).toContainEqual({ start: 30000, end: 90000 })
    })
  })

  describe('SessionWindowAssigner', () => {
    it('should create session window with gap', () => {
      const assigner = new SessionWindowAssigner(30000) // 30s gap

      const windows = assigner.assignWindows(1000)

      expect(windows).toHaveLength(1)
      expect(windows[0]).toEqual({ start: 1000, end: 31000 })
    })

    it('should merge overlapping sessions', () => {
      const assigner = new SessionWindowAssigner(30000)
      const existingWindows = new Map([
        ['0-30000', { start: 0, end: 30000 }],
      ])

      // New event at 20s should merge with existing session
      const windows = assigner.assignWindows(20000, existingWindows)

      expect(windows).toHaveLength(1)
      expect(windows[0].start).toBe(0)
      expect(windows[0].end).toBe(50000) // Extended by new event
    })
  })
})

// =============================================================================
// CheckpointBarrier Tests
// =============================================================================

describe('CheckpointBarrier', () => {
  describe('BarrierAligner', () => {
    it('should wait for barriers from all input channels', async () => {
      const alignedCallback = vi.fn()
      const aligner = new BarrierAligner(['ch1', 'ch2', 'ch3'], alignedCallback)

      const barrier: CheckpointBarrier = {
        checkpointId: 1n,
        timestamp: Date.now(),
        options: { mode: 'aligned', timeout: 60000 },
      }

      // Send barrier from ch1 - should not trigger
      await aligner.processBarrier('ch1', barrier)
      expect(alignedCallback).not.toHaveBeenCalled()

      // Send barrier from ch2 - should not trigger
      await aligner.processBarrier('ch2', barrier)
      expect(alignedCallback).not.toHaveBeenCalled()

      // Send barrier from ch3 - should trigger aligned callback
      await aligner.processBarrier('ch3', barrier)
      expect(alignedCallback).toHaveBeenCalledWith(barrier)
    })

    it('should block channels that received barrier', () => {
      const aligner = new BarrierAligner(['ch1', 'ch2'], vi.fn())

      const barrier: CheckpointBarrier = {
        checkpointId: 1n,
        timestamp: Date.now(),
        options: { mode: 'aligned', timeout: 60000 },
      }

      aligner.processBarrier('ch1', barrier)

      expect(aligner.isBlocked('ch1')).toBe(true)
      expect(aligner.isBlocked('ch2')).toBe(false)
    })

    it('should release blocked channels after alignment', async () => {
      const aligner = new BarrierAligner(['ch1', 'ch2'], vi.fn())

      const barrier: CheckpointBarrier = {
        checkpointId: 1n,
        timestamp: Date.now(),
        options: { mode: 'aligned', timeout: 60000 },
      }

      await aligner.processBarrier('ch1', barrier)
      await aligner.processBarrier('ch2', barrier)

      expect(aligner.isBlocked('ch1')).toBe(false)
      expect(aligner.isBlocked('ch2')).toBe(false)
    })
  })

  describe('CheckpointCoordinator', () => {
    it('should trigger checkpoint across sources', async () => {
      const source1 = { injectBarrier: vi.fn().mockResolvedValue(undefined) }
      const source2 = { injectBarrier: vi.fn().mockResolvedValue(undefined) }
      const sink1 = { acknowledge: vi.fn().mockResolvedValue(undefined) }

      const coordinator = new CheckpointCoordinator({
        sources: [source1, source2],
        sinks: [sink1],
      })

      const result = await coordinator.triggerCheckpoint()

      expect(source1.injectBarrier).toHaveBeenCalled()
      expect(source2.injectBarrier).toHaveBeenCalled()
      expect(result.checkpointId).toBeDefined()
      expect(result.status).toBe('completed')
    })

    it('should handle checkpoint timeout', async () => {
      const source1 = { injectBarrier: vi.fn().mockResolvedValue(undefined) }
      const sink1 = {
        acknowledge: vi.fn().mockImplementation(() => new Promise(() => {})), // Never resolves
      }

      const coordinator = new CheckpointCoordinator({
        sources: [source1],
        sinks: [sink1],
        defaultTimeout: 100,
      })

      const result = await coordinator.triggerCheckpoint()

      expect(result.status).toBe('failed')
      expect(result.failureReason).toMatch(/timeout/i)
    })

    it('should support savepoint mode', async () => {
      const source1 = { injectBarrier: vi.fn().mockResolvedValue(undefined) }
      const sink1 = { acknowledge: vi.fn().mockResolvedValue(undefined) }

      const coordinator = new CheckpointCoordinator({
        sources: [source1],
        sinks: [sink1],
      })

      const result = await coordinator.triggerCheckpoint({ savepoint: true })

      expect(result.isSavepoint).toBe(true)
    })
  })
})

// =============================================================================
// TTL State Tests
// =============================================================================

describe('TTLStateWrapper', () => {
  let innerBackend: StateBackend<string>

  beforeEach(() => {
    innerBackend = new InMemoryStateBackend<string>('ttl-test')
  })

  describe('lazy cleanup', () => {
    it('should expire entries on read', async () => {
      const policy: TTLPolicy = {
        ttlMs: 100,
        updateOnRead: false,
        updateOnWrite: true,
        cleanupStrategy: { type: 'lazy' },
      }

      const wrapper = new TTLStateWrapper(innerBackend, policy)

      await wrapper.put('key1', 'value1')
      expect(await wrapper.get('key1')).toBe('value1')

      // Wait for TTL
      await new Promise((r) => setTimeout(r, 150))

      expect(await wrapper.get('key1')).toBeUndefined()
    })

    it('should update TTL on read when configured', async () => {
      const policy: TTLPolicy = {
        ttlMs: 100,
        updateOnRead: true,
        updateOnWrite: true,
        cleanupStrategy: { type: 'lazy' },
      }

      const wrapper = new TTLStateWrapper(innerBackend, policy)

      await wrapper.put('key1', 'value1')

      // Read before TTL expires, resetting TTL
      await new Promise((r) => setTimeout(r, 80))
      expect(await wrapper.get('key1')).toBe('value1')

      // Read again before new TTL expires
      await new Promise((r) => setTimeout(r, 80))
      expect(await wrapper.get('key1')).toBe('value1')

      // Wait for full TTL without reads
      await new Promise((r) => setTimeout(r, 150))
      expect(await wrapper.get('key1')).toBeUndefined()
    })
  })

  describe('eager cleanup', () => {
    it('should run background cleanup', async () => {
      const policy: TTLPolicy = {
        ttlMs: 50,
        updateOnRead: false,
        updateOnWrite: true,
        cleanupStrategy: { type: 'eager', intervalMs: 100 },
      }

      const mockScheduler = {
        schedule: vi.fn(),
        cancel: vi.fn(),
      }

      const wrapper = new TTLStateWrapper(innerBackend, policy, mockScheduler)

      await wrapper.put('key1', 'value1')
      await wrapper.put('key2', 'value2')

      // Cleanup callback should have been scheduled
      expect(mockScheduler.schedule).toHaveBeenCalled()

      // Simulate cleanup
      await new Promise((r) => setTimeout(r, 100))
      const result = await wrapper.runCleanup()

      expect(result.cleanedCount).toBeGreaterThanOrEqual(0)
    })
  })

  describe('watermark-based cleanup', () => {
    it('should expire state based on watermark', async () => {
      const policy: TTLPolicy = {
        ttlMs: 0, // Not used for watermark strategy
        updateOnRead: false,
        updateOnWrite: false,
        cleanupStrategy: { type: 'watermark', allowedLateness: 10000 },
      }

      const wrapper = new TTLStateWrapper(innerBackend, policy)

      // Store entries with event time context
      await wrapper.put('key1', 'value1')
      await wrapper.put('key2', 'value2')

      // Advance watermark
      await wrapper.onWatermark(Date.now() + 20000)

      // Should expire entries based on watermark
      expect(await wrapper.get('key1')).toBeUndefined()
    })
  })
})

// =============================================================================
// State Recovery Tests
// =============================================================================

describe('StateRecoveryManager', () => {
  it('should find latest completed checkpoint', async () => {
    const checkpointStore: CheckpointStore = {
      listCompleted: vi.fn().mockResolvedValue([
        { checkpointId: 1n, status: 'completed', timestamp: 1000 },
        { checkpointId: 3n, status: 'completed', timestamp: 3000 },
        { checkpointId: 2n, status: 'completed', timestamp: 2000 },
      ]),
      get: vi.fn(),
      getSnapshot: vi.fn(),
    }

    const manager = new StateRecoveryManager(checkpointStore, new Map())
    const latest = await manager.findLatestCheckpoint()

    expect(latest?.checkpointId).toBe(3n)
  })

  it('should restore operator state from checkpoint', async () => {
    const snapshot: StateSnapshot = {
      id: 'snap-1',
      timestamp: Date.now(),
      data: new Uint8Array([1, 2, 3]),
      metadata: { stateCount: 2, totalBytes: 100, checksum: 'abc' },
    }

    const operator = {
      restoreState: vi.fn().mockResolvedValue(undefined),
    }

    const checkpointStore: CheckpointStore = {
      listCompleted: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue({
        checkpointId: 1n,
        timestamp: Date.now(),
        operatorStates: new Map([['op1', 'snap-1']]),
        sourceOffsets: new Map(),
        status: 'completed',
      }),
      getSnapshot: vi.fn().mockResolvedValue(snapshot),
    }

    const operators = new Map([['op1', operator]])
    const manager = new StateRecoveryManager(checkpointStore, operators)

    await manager.recover(1n)

    expect(operator.restoreState).toHaveBeenCalledWith(snapshot)
  })

  it('should throw if no checkpoint available', async () => {
    const checkpointStore: CheckpointStore = {
      listCompleted: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(undefined),
      getSnapshot: vi.fn(),
    }

    const manager = new StateRecoveryManager(checkpointStore, new Map())

    await expect(manager.recover()).rejects.toThrow(/no checkpoint/i)
  })

  it('should validate checksum during restore', async () => {
    const snapshot: StateSnapshot = {
      id: 'snap-1',
      timestamp: Date.now(),
      data: new Uint8Array([1, 2, 3]),
      metadata: { stateCount: 2, totalBytes: 100, checksum: 'wrong' },
    }

    const operator = {
      restoreState: vi.fn().mockRejectedValue(new Error('Checksum mismatch')),
    }

    const checkpointStore: CheckpointStore = {
      listCompleted: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue({
        checkpointId: 1n,
        timestamp: Date.now(),
        operatorStates: new Map([['op1', 'snap-1']]),
        sourceOffsets: new Map(),
        status: 'completed',
      }),
      getSnapshot: vi.fn().mockResolvedValue(snapshot),
    }

    const operators = new Map([['op1', operator]])
    const manager = new StateRecoveryManager(checkpointStore, operators)

    await expect(manager.recover(1n)).rejects.toThrow(/checksum/i)
  })
})

// =============================================================================
// State Metrics Tests
// =============================================================================

describe('MetricsStateWrapper', () => {
  let innerBackend: StateBackend<string>
  let metricsRegistry: MetricsRegistry

  beforeEach(() => {
    innerBackend = new InMemoryStateBackend<string>('metrics-test')
    metricsRegistry = createStateMetrics()
  })

  it('should track read operations', async () => {
    const wrapper = new MetricsStateWrapper(innerBackend, metricsRegistry, 'test-op')

    await wrapper.get('key1')
    await wrapper.get('key2')

    const metrics = wrapper.getMetrics()
    expect(metrics.reads.value()).toBe(2)
  })

  it('should track write operations', async () => {
    const wrapper = new MetricsStateWrapper(innerBackend, metricsRegistry, 'test-op')

    await wrapper.put('key1', 'value1')
    await wrapper.put('key2', 'value2')

    const metrics = wrapper.getMetrics()
    expect(metrics.writes.value()).toBe(2)
  })

  it('should track delete operations', async () => {
    const wrapper = new MetricsStateWrapper(innerBackend, metricsRegistry, 'test-op')

    await wrapper.put('key1', 'value1')
    await wrapper.delete('key1')

    const metrics = wrapper.getMetrics()
    expect(metrics.deletes.value()).toBe(1)
  })

  it('should track state size', async () => {
    const wrapper = new MetricsStateWrapper(innerBackend, metricsRegistry, 'test-op')

    await wrapper.put('key1', 'value1')
    await wrapper.put('key2', 'value2')

    const metrics = wrapper.getMetrics()
    expect(metrics.keyCount).toBe(2)
    expect(metrics.totalBytes).toBeGreaterThan(0)
  })

  it('should track checkpoint metrics', async () => {
    const wrapper = new MetricsStateWrapper(innerBackend, metricsRegistry, 'test-op')

    await wrapper.put('key1', 'value1')
    await wrapper.snapshot()

    const metrics = wrapper.getMetrics()
    expect(metrics.lastCheckpointDuration.value()).toBeGreaterThan(0)
    expect(metrics.lastCheckpointSize.value()).toBeGreaterThan(0)
  })

  it('should track checkpoint failures', async () => {
    // Create a backend that fails on snapshot
    const failingBackend: StateBackend<string> = {
      ...innerBackend,
      snapshot: vi.fn().mockRejectedValue(new Error('Snapshot failed')),
    }

    const wrapper = new MetricsStateWrapper(failingBackend, metricsRegistry, 'test-op')

    await expect(wrapper.snapshot()).rejects.toThrow()

    const metrics = wrapper.getMetrics()
    expect(metrics.checkpointFailures.value()).toBe(1)
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('StatefulOperator Integration', () => {
  it('should support full checkpoint-restore cycle', async () => {
    // Setup keyed state with window aggregation
    const backend = new InMemoryStateBackend<number>('integration-test')
    const keyedState = createKeyedState<string, number>(backend)

    // Accumulate some state
    await keyedState.update('user:1', (v) => (v ?? 0) + 10)
    await keyedState.update('user:2', (v) => (v ?? 0) + 20)
    await keyedState.update('user:1', (v) => (v ?? 0) + 5)

    // Snapshot
    const snapshot = await backend.snapshot()

    // Modify state after snapshot
    await keyedState.update('user:1', (v) => (v ?? 0) + 100)
    await keyedState.put('user:3', 999)

    // Verify modified state
    expect(await keyedState.get('user:1')).toBe(115)
    expect(await keyedState.get('user:3')).toBe(999)

    // Restore from snapshot
    await backend.restore(snapshot)

    // Verify restored state
    expect(await keyedState.get('user:1')).toBe(15) // Original value
    expect(await keyedState.get('user:2')).toBe(20)
    expect(await keyedState.get('user:3')).toBeUndefined() // Didn't exist
  })

  it('should coordinate checkpoint across multiple operators', async () => {
    const backend1 = new InMemoryStateBackend<string>('op1')
    const backend2 = new InMemoryStateBackend<number>('op2')

    const source = {
      injectBarrier: vi.fn().mockResolvedValue(undefined),
    }

    const sink = {
      acknowledge: vi.fn().mockResolvedValue(undefined),
    }

    const coordinator = new CheckpointCoordinator({
      sources: [source],
      sinks: [sink],
    })

    // Add some state
    await backend1.put('key1', 'value1')
    await backend2.put('key2', 42)

    // Trigger checkpoint
    const result = await coordinator.triggerCheckpoint()

    expect(result.status).toBe('completed')
    expect(source.injectBarrier).toHaveBeenCalled()
  })
})
