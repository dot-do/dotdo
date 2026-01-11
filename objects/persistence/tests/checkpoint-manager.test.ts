/**
 * Checkpoint Manager Tests (RED Phase - TDD)
 *
 * Tests for the checkpoint/snapshot system that provides:
 * - Periodic full state snapshots
 * - Crash recovery points
 * - State backup/restore
 *
 * RED PHASE: All tests should FAIL initially.
 * GREEN PHASE: Implement CheckpointManager to make tests pass.
 * REFACTOR: Optimize implementation.
 *
 * @module objects/persistence/tests/checkpoint-manager.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type {
  Checkpoint,
  StateSnapshot,
  CheckpointConfig,
  PersistenceState,
} from '../types'

// GREEN PHASE: Implementation is complete
import { CheckpointManager } from '../checkpoint-manager'

// ============================================================================
// MOCK TYPES FOR TESTING
// ============================================================================

interface MockStorage {
  data: Map<string, unknown>
  get<T>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<void>
  delete(key: string): Promise<boolean>
  list(options?: { prefix?: string }): Promise<Map<string, unknown>>
  sql: {
    exec(query: string, ...params: unknown[]): { toArray(): unknown[] }
  }
}

interface MockR2Bucket {
  objects: Map<string, { data: Uint8Array; metadata?: Record<string, string> }>
  put(key: string, data: ArrayBuffer | Uint8Array | string, options?: { customMetadata?: Record<string, string> }): Promise<void>
  get(key: string): Promise<{ body: ReadableStream; customMetadata?: Record<string, string> } | null>
  delete(key: string | string[]): Promise<void>
  list(options?: { prefix?: string }): Promise<{ objects: { key: string }[] }>
}

interface MockEnv {
  R2_SNAPSHOTS?: MockR2Bucket
}

// ============================================================================
// TEST HELPERS
// ============================================================================

function createMockStorage(): MockStorage {
  const data = new Map<string, unknown>()

  return {
    data,
    async get<T>(key: string): Promise<T | undefined> {
      return data.get(key) as T | undefined
    },
    async put<T>(key: string, value: T): Promise<void> {
      data.set(key, value)
    },
    async delete(key: string): Promise<boolean> {
      return data.delete(key)
    },
    async list(options?: { prefix?: string }): Promise<Map<string, unknown>> {
      const result = new Map<string, unknown>()
      for (const [k, v] of data) {
        if (!options?.prefix || k.startsWith(options.prefix)) {
          result.set(k, v)
        }
      }
      return result
    },
    sql: {
      exec(query: string, ...params: unknown[]) {
        // Simple mock - returns empty array by default
        return { toArray: () => [] }
      }
    }
  }
}

function createMockR2Bucket(): MockR2Bucket {
  const objects = new Map<string, { data: Uint8Array; metadata?: Record<string, string> }>()

  return {
    objects,
    async put(key: string, data: ArrayBuffer | Uint8Array | string, options?: { customMetadata?: Record<string, string> }): Promise<void> {
      const bytes = typeof data === 'string'
        ? new TextEncoder().encode(data)
        : data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : data
      objects.set(key, { data: bytes, metadata: options?.customMetadata })
    },
    async get(key: string): Promise<{ body: ReadableStream; customMetadata?: Record<string, string> } | null> {
      const obj = objects.get(key)
      if (!obj) return null

      return {
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(obj.data)
            controller.close()
          }
        }),
        customMetadata: obj.metadata
      }
    },
    async delete(key: string | string[]): Promise<void> {
      const keys = Array.isArray(key) ? key : [key]
      for (const k of keys) {
        objects.delete(k)
      }
    },
    async list(options?: { prefix?: string }): Promise<{ objects: { key: string }[] }> {
      const result: { key: string }[] = []
      for (const k of objects.keys()) {
        if (!options?.prefix || k.startsWith(options.prefix)) {
          result.push({ key: k })
        }
      }
      return { objects: result }
    }
  }
}

function createTestData(): Map<string, unknown[]> {
  return new Map([
    ['things', Array.from({ length: 100 }, (_, i) => ({
      id: `thing-${i}`,
      type: 1,
      data: { index: i, name: `Item ${i}` },
      version: 1,
      branch: null,
      deleted: false,
    }))],
    ['relationships', Array.from({ length: 50 }, (_, i) => ({
      id: `rel-${i}`,
      from: `thing-${i}`,
      to: `thing-${i + 1}`,
      verb: 'related_to',
      data: null,
    }))],
    ['actions', Array.from({ length: 20 }, (_, i) => ({
      id: `action-${i}`,
      verb: 'update',
      actor: 'user-1',
      status: 'completed',
    }))],
  ])
}

// ============================================================================
// TEST SUITE: CHECKPOINT MANAGER
// ============================================================================

describe('CheckpointManager', () => {
  let storage: MockStorage
  let r2Bucket: MockR2Bucket
  let env: MockEnv
  let manager: CheckpointManager

  beforeEach(() => {
    vi.useFakeTimers()
    storage = createMockStorage()
    r2Bucket = createMockR2Bucket()
    env = { R2_SNAPSHOTS: r2Bucket }

    // Populate with test data
    const testData = createTestData()
    for (const [table, rows] of testData) {
      storage.data.set(`table:${table}`, rows)
    }

    // Create the manager for tests
    manager = new CheckpointManager(storage, env, 'test-ns', {
      schemaVersion: 1,
      config: { createSnapshots: false },
      tableNames: ['things', 'relationships', 'actions'],
      tableDataExtractor: async (tableName: string) => {
        return (storage.data.get(`table:${tableName}`) as unknown[]) ?? []
      },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ==========================================================================
  // CHECKPOINT CREATION
  // ==========================================================================

  describe('Checkpoint Creation', () => {
    it('should create a checkpoint with unique ID', async () => {
      // RED: CheckpointManager.createCheckpoint should return a Checkpoint
      // manager is initialized in beforeEach

      const checkpoint = await manager.createCheckpoint(100)

      expect(checkpoint.id).toBeDefined()
      expect(typeof checkpoint.id).toBe('string')
      expect(checkpoint.id.length).toBeGreaterThan(0)
    })

    it('should store checkpoint with correct WAL position', async () => {
      // manager is initialized in beforeEach

      const checkpoint = await manager.createCheckpoint(42)

      expect(checkpoint.walPosition).toBe(42)
    })

    it('should include schema version in checkpoint', async () => {
      // manager is initialized in beforeEach

      const checkpoint = await manager.createCheckpoint(100)

      expect(checkpoint.schemaVersion).toBeGreaterThan(0)
    })

    it('should mark checkpoint as verified after creation', async () => {
      // manager is initialized in beforeEach

      const checkpoint = await manager.createCheckpoint(100)

      expect(checkpoint.verified).toBe(true)
    })

    it('should persist checkpoint to storage', async () => {
      // manager is initialized in beforeEach

      const checkpoint = await manager.createCheckpoint(100)
      const retrieved = await manager.getCheckpoint(checkpoint.id)

      expect(retrieved).toBeDefined()
      expect(retrieved?.id).toBe(checkpoint.id)
    })

    it('should create monotonically increasing checkpoint IDs', async () => {
      // manager is initialized in beforeEach

      const cp1 = await manager.createCheckpoint(10)
      const cp2 = await manager.createCheckpoint(20)
      const cp3 = await manager.createCheckpoint(30)

      // Checkpoint IDs or sequence numbers should be increasing
      expect(cp2.createdAt).toBeGreaterThanOrEqual(cp1.createdAt)
      expect(cp3.createdAt).toBeGreaterThanOrEqual(cp2.createdAt)
    })
  })

  // ==========================================================================
  // AUTOMATIC CHECKPOINTING
  // ==========================================================================

  describe('Automatic Checkpointing', () => {
    it('should create checkpoint after interval expires', async () => {
      const config: CheckpointConfig = { intervalMs: 60000 } // 1 minute
      const manager = null as unknown as {
        start(): void
        getCheckpoints(): Promise<Checkpoint[]>
        onWalEntry(lsn: number): void
      }

      manager.start()

      // Simulate some WAL entries
      for (let i = 1; i <= 10; i++) {
        manager.onWalEntry(i)
      }

      // Advance time past interval
      await vi.advanceTimersByTimeAsync(65000)

      const checkpoints = await manager.getCheckpoints()
      expect(checkpoints.length).toBeGreaterThan(0)
    })

    it('should create checkpoint when WAL entry count exceeds threshold', async () => {
      const config: CheckpointConfig = { maxWalEntries: 100, intervalMs: 3600000 }
      const manager = null as unknown as {
        configure(config: CheckpointConfig): void
        onWalEntry(lsn: number): Promise<void>
        getCheckpoints(): Promise<Checkpoint[]>
      }

      manager.configure(config)

      // Add entries up to threshold
      for (let i = 1; i <= 101; i++) {
        await manager.onWalEntry(i)
      }

      const checkpoints = await manager.getCheckpoints()
      expect(checkpoints.length).toBeGreaterThan(0)
    })

    it('should respect both interval and entry count thresholds', async () => {
      const config: CheckpointConfig = {
        intervalMs: 60000,
        maxWalEntries: 50
      }
      const manager = null as unknown as {
        configure(config: CheckpointConfig): void
        start(): void
        onWalEntry(lsn: number): Promise<void>
        getCheckpoints(): Promise<Checkpoint[]>
      }

      manager.configure(config)
      manager.start()

      // Add 51 entries (should trigger by count)
      for (let i = 1; i <= 51; i++) {
        await manager.onWalEntry(i)
      }

      const checkpointsByCount = await manager.getCheckpoints()
      expect(checkpointsByCount.length).toBe(1)

      // Wait for interval (should trigger again)
      await vi.advanceTimersByTimeAsync(65000)

      const checkpointsByTime = await manager.getCheckpoints()
      expect(checkpointsByTime.length).toBe(2)
    })
  })

  // ==========================================================================
  // SNAPSHOT CREATION
  // ==========================================================================

  describe('Snapshot Creation', () => {
    it('should create full state snapshot', async () => {
      const config: CheckpointConfig = { createSnapshots: true }
      const manager = null as unknown as {
        configure(config: CheckpointConfig): void
        createSnapshot(): Promise<StateSnapshot>
      }

      manager.configure(config)

      const snapshot = await manager.createSnapshot()

      expect(snapshot.id).toBeDefined()
      expect(snapshot.data).toBeDefined()
      expect(snapshot.data.length).toBeGreaterThan(0)
    })

    it('should include all tables in snapshot', async () => {
      const manager = null as unknown as {
        createSnapshot(): Promise<StateSnapshot>
        restoreFromSnapshot(snapshot: StateSnapshot): Promise<void>
        getTableData(table: string): Promise<unknown[]>
      }

      const snapshot = await manager.createSnapshot()

      // Restore and verify all tables present
      await manager.restoreFromSnapshot(snapshot)

      const things = await manager.getTableData('things')
      const relationships = await manager.getTableData('relationships')
      const actions = await manager.getTableData('actions')

      expect(things.length).toBe(100)
      expect(relationships.length).toBe(50)
      expect(actions.length).toBe(20)
    })

    it('should calculate correct checksum for snapshot', async () => {
      const manager = null as unknown as {
        createSnapshot(): Promise<StateSnapshot>
        verifyChecksum(snapshot: StateSnapshot): Promise<boolean>
      }

      const snapshot = await manager.createSnapshot()

      expect(snapshot.checksum).toBeDefined()
      expect(typeof snapshot.checksum).toBe('string')

      const isValid = await manager.verifyChecksum(snapshot)
      expect(isValid).toBe(true)
    })

    it('should compress snapshot data', async () => {
      const config: CheckpointConfig = { compressSnapshots: true }
      const manager = null as unknown as {
        configure(config: CheckpointConfig): void
        createSnapshot(): Promise<StateSnapshot>
      }

      manager.configure(config)

      const snapshot = await manager.createSnapshot()

      // Compressed should be smaller than raw JSON
      const rawJson = JSON.stringify(createTestData())
      expect(snapshot.sizeBytes).toBeLessThan(rawJson.length)
    })

    it('should store snapshot in R2', async () => {
      const manager = null as unknown as {
        createSnapshot(): Promise<StateSnapshot>
      }

      const snapshot = await manager.createSnapshot()

      // Verify snapshot was stored in R2
      const stored = await r2Bucket.get(`snapshots/${snapshot.id}.gz`)
      expect(stored).not.toBeNull()
    })

    it('should associate snapshot with checkpoint', async () => {
      const config: CheckpointConfig = { createSnapshots: true }
      const manager = null as unknown as {
        configure(config: CheckpointConfig): void
        createCheckpoint(walPosition: number): Promise<Checkpoint>
      }

      manager.configure(config)

      const checkpoint = await manager.createCheckpoint(100)

      expect(checkpoint.snapshotId).toBeDefined()
    })
  })

  // ==========================================================================
  // SNAPSHOT RESTORATION
  // ==========================================================================

  describe('Snapshot Restoration', () => {
    it('should restore state from snapshot', async () => {
      const manager = null as unknown as {
        createSnapshot(): Promise<StateSnapshot>
        clearAll(): Promise<void>
        restoreFromSnapshot(snapshot: StateSnapshot): Promise<void>
        getTableData(table: string): Promise<unknown[]>
      }

      // Create snapshot
      const snapshot = await manager.createSnapshot()

      // Clear all data
      await manager.clearAll()

      // Restore from snapshot
      await manager.restoreFromSnapshot(snapshot)

      // Verify data restored
      const things = await manager.getTableData('things')
      expect(things.length).toBe(100)
    })

    it('should restore from R2 by snapshot ID', async () => {
      const manager = null as unknown as {
        createSnapshot(): Promise<StateSnapshot>
        clearAll(): Promise<void>
        restoreFromSnapshotId(id: string): Promise<void>
        getTableData(table: string): Promise<unknown[]>
      }

      const snapshot = await manager.createSnapshot()
      await manager.clearAll()

      await manager.restoreFromSnapshotId(snapshot.id)

      const things = await manager.getTableData('things')
      expect(things.length).toBe(100)
    })

    it('should verify checksum before restore', async () => {
      const manager = null as unknown as {
        restoreFromSnapshot(snapshot: StateSnapshot): Promise<void>
      }

      const corruptSnapshot: StateSnapshot = {
        id: 'corrupt-1',
        ns: 'test',
        schemaVersion: 1,
        sequence: 1,
        createdAt: Date.now(),
        sizeBytes: 100,
        checksum: 'invalid-checksum',
        data: new Uint8Array([1, 2, 3]),
      }

      await expect(manager.restoreFromSnapshot(corruptSnapshot))
        .rejects.toThrow(/checksum.*mismatch|integrity.*failed/i)
    })

    it('should handle schema version mismatch', async () => {
      const manager = null as unknown as {
        createSnapshot(): Promise<StateSnapshot>
        schemaVersion: number
        restoreFromSnapshot(snapshot: StateSnapshot): Promise<void>
      }

      const oldSnapshot = await manager.createSnapshot()

      // Simulate schema upgrade
      (manager as { schemaVersion: number }).schemaVersion = 99

      // Should warn or error about version mismatch
      await expect(manager.restoreFromSnapshot(oldSnapshot))
        .rejects.toThrow(/schema.*version|migration.*required/i)
    })

    it('should support point-in-time recovery via checkpoint', async () => {
      const manager = null as unknown as {
        createCheckpoint(walPosition: number): Promise<Checkpoint>
        restoreToCheckpoint(checkpoint: Checkpoint): Promise<void>
        getWalPosition(): number
      }

      const checkpoint = await manager.createCheckpoint(50)

      await manager.restoreToCheckpoint(checkpoint)

      expect(manager.getWalPosition()).toBe(50)
    })
  })

  // ==========================================================================
  // SNAPSHOT RETENTION
  // ==========================================================================

  describe('Snapshot Retention', () => {
    it('should delete old snapshots beyond retention period', async () => {
      const config: CheckpointConfig = {
        createSnapshots: true,
        snapshotRetentionMs: 86400000 // 1 day
      }
      const manager = null as unknown as {
        configure(config: CheckpointConfig): void
        createSnapshot(): Promise<StateSnapshot>
        cleanupOldSnapshots(): Promise<number>
        getSnapshots(): Promise<StateSnapshot[]>
      }

      manager.configure(config)

      // Create snapshot
      await manager.createSnapshot()

      // Advance time past retention
      await vi.advanceTimersByTimeAsync(86400001)

      // Create another snapshot to trigger cleanup
      await manager.createSnapshot()
      await manager.cleanupOldSnapshots()

      const snapshots = await manager.getSnapshots()
      expect(snapshots.length).toBe(1)
    })

    it('should keep at least minSnapshots even if expired', async () => {
      const config: CheckpointConfig = {
        createSnapshots: true,
        snapshotRetentionMs: 1000,
        maxSnapshots: 2
      }
      const manager = null as unknown as {
        configure(config: CheckpointConfig): void
        createSnapshot(): Promise<StateSnapshot>
        cleanupOldSnapshots(): Promise<number>
        getSnapshots(): Promise<StateSnapshot[]>
      }

      manager.configure(config)

      // Create multiple snapshots
      await manager.createSnapshot()
      await vi.advanceTimersByTimeAsync(500)
      await manager.createSnapshot()
      await vi.advanceTimersByTimeAsync(500)
      await manager.createSnapshot()

      // All are now expired
      await vi.advanceTimersByTimeAsync(1001)
      await manager.cleanupOldSnapshots()

      const snapshots = await manager.getSnapshots()
      // Should keep at least 1 for recovery
      expect(snapshots.length).toBeGreaterThan(0)
    })

    it('should respect maxSnapshots limit', async () => {
      const config: CheckpointConfig = {
        createSnapshots: true,
        maxSnapshots: 3
      }
      const manager = null as unknown as {
        configure(config: CheckpointConfig): void
        createSnapshot(): Promise<StateSnapshot>
        getSnapshots(): Promise<StateSnapshot[]>
      }

      manager.configure(config)

      // Create more than max snapshots
      for (let i = 0; i < 5; i++) {
        await manager.createSnapshot()
        await vi.advanceTimersByTimeAsync(100)
      }

      const snapshots = await manager.getSnapshots()
      expect(snapshots.length).toBeLessThanOrEqual(3)
    })
  })

  // ==========================================================================
  // CHECKPOINT MANAGEMENT
  // ==========================================================================

  describe('Checkpoint Management', () => {
    it('should get latest checkpoint', async () => {
      const manager = null as unknown as {
        createCheckpoint(walPosition: number): Promise<Checkpoint>
        getLatestCheckpoint(): Promise<Checkpoint | null>
      }

      await manager.createCheckpoint(10)
      await manager.createCheckpoint(20)
      const latest = await manager.createCheckpoint(30)

      const retrieved = await manager.getLatestCheckpoint()

      expect(retrieved?.walPosition).toBe(30)
    })

    it('should list checkpoints in order', async () => {
      const manager = null as unknown as {
        createCheckpoint(walPosition: number): Promise<Checkpoint>
        getCheckpoints(options?: { limit?: number; order?: 'asc' | 'desc' }): Promise<Checkpoint[]>
      }

      await manager.createCheckpoint(10)
      await manager.createCheckpoint(20)
      await manager.createCheckpoint(30)

      const checkpoints = await manager.getCheckpoints({ order: 'desc' })

      expect(checkpoints[0].walPosition).toBe(30)
      expect(checkpoints[2].walPosition).toBe(10)
    })

    it('should delete checkpoint and associated snapshot', async () => {
      const config: CheckpointConfig = { createSnapshots: true }
      const manager = null as unknown as {
        configure(config: CheckpointConfig): void
        createCheckpoint(walPosition: number): Promise<Checkpoint>
        deleteCheckpoint(id: string): Promise<void>
        getCheckpoint(id: string): Promise<Checkpoint | null>
        getSnapshot(id: string): Promise<StateSnapshot | null>
      }

      manager.configure(config)

      const checkpoint = await manager.createCheckpoint(100)
      const snapshotId = checkpoint.snapshotId!

      await manager.deleteCheckpoint(checkpoint.id)

      const deletedCheckpoint = await manager.getCheckpoint(checkpoint.id)
      const deletedSnapshot = await manager.getSnapshot(snapshotId)

      expect(deletedCheckpoint).toBeNull()
      expect(deletedSnapshot).toBeNull()
    })

    it('should find checkpoint by WAL position', async () => {
      const manager = null as unknown as {
        createCheckpoint(walPosition: number): Promise<Checkpoint>
        getCheckpointForWalPosition(lsn: number): Promise<Checkpoint | null>
      }

      await manager.createCheckpoint(10)
      await manager.createCheckpoint(20)
      await manager.createCheckpoint(30)

      // Should return checkpoint at or before position 25
      const checkpoint = await manager.getCheckpointForWalPosition(25)

      expect(checkpoint?.walPosition).toBe(20)
    })
  })

  // ==========================================================================
  // ERROR HANDLING
  // ==========================================================================

  describe('Error Handling', () => {
    it('should handle R2 write failure gracefully', async () => {
      const manager = null as unknown as {
        createSnapshot(): Promise<StateSnapshot>
      }

      // Simulate R2 failure
      r2Bucket.put = async () => { throw new Error('R2 unavailable') }

      await expect(manager.createSnapshot())
        .rejects.toThrow(/R2.*unavailable|storage.*error/i)
    })

    it('should handle corrupt snapshot data', async () => {
      const manager = null as unknown as {
        restoreFromSnapshotId(id: string): Promise<void>
      }

      // Store corrupt data
      await r2Bucket.put('snapshots/corrupt-1.gz', new Uint8Array([0, 0, 0, 255]))

      await expect(manager.restoreFromSnapshotId('corrupt-1'))
        .rejects.toThrow(/corrupt|invalid|decompress/i)
    })

    it('should handle missing snapshot gracefully', async () => {
      const manager = null as unknown as {
        restoreFromSnapshotId(id: string): Promise<void>
      }

      await expect(manager.restoreFromSnapshotId('non-existent'))
        .rejects.toThrow(/not found|missing/i)
    })

    it('should retry failed operations', async () => {
      let attempts = 0
      const manager = null as unknown as {
        createSnapshot(options?: { maxRetries?: number }): Promise<StateSnapshot>
      }

      // Simulate transient failure
      const originalPut = r2Bucket.put.bind(r2Bucket)
      r2Bucket.put = async (...args: Parameters<typeof originalPut>) => {
        attempts++
        if (attempts < 3) throw new Error('Transient error')
        return originalPut(...args)
      }

      const snapshot = await manager.createSnapshot({ maxRetries: 3 })

      expect(snapshot).toBeDefined()
      expect(attempts).toBe(3)
    })
  })

  // ==========================================================================
  // CONCURRENT OPERATIONS
  // ==========================================================================

  describe('Concurrent Operations', () => {
    it('should handle concurrent checkpoint creation', async () => {
      const manager = null as unknown as {
        createCheckpoint(walPosition: number): Promise<Checkpoint>
      }

      // Create checkpoints concurrently
      const promises = [
        manager.createCheckpoint(10),
        manager.createCheckpoint(20),
        manager.createCheckpoint(30),
      ]

      const checkpoints = await Promise.all(promises)

      // All should succeed with unique IDs
      const ids = new Set(checkpoints.map(cp => cp.id))
      expect(ids.size).toBe(3)
    })

    it('should prevent concurrent restore operations', async () => {
      const manager = null as unknown as {
        createSnapshot(): Promise<StateSnapshot>
        restoreFromSnapshot(snapshot: StateSnapshot): Promise<void>
        isRestoreInProgress(): boolean
      }

      const snapshot = await manager.createSnapshot()

      // Start restore
      const restorePromise = manager.restoreFromSnapshot(snapshot)

      // Try concurrent restore
      expect(manager.isRestoreInProgress()).toBe(true)
      await expect(manager.restoreFromSnapshot(snapshot))
        .rejects.toThrow(/restore.*in progress|concurrent.*restore/i)

      await restorePromise
    })

    it('should serialize checkpoint and snapshot operations', async () => {
      const manager = null as unknown as {
        createCheckpoint(walPosition: number): Promise<Checkpoint>
        createSnapshot(): Promise<StateSnapshot>
      }

      // These should not corrupt each other
      const operations = [
        manager.createCheckpoint(10),
        manager.createSnapshot(),
        manager.createCheckpoint(20),
        manager.createSnapshot(),
      ]

      const results = await Promise.all(operations)

      // All should complete successfully
      expect(results.length).toBe(4)
    })
  })

  // ==========================================================================
  // PERSISTENCE STATE
  // ==========================================================================

  describe('Persistence State', () => {
    it('should track WAL entries since last checkpoint', async () => {
      const manager = null as unknown as {
        createCheckpoint(walPosition: number): Promise<Checkpoint>
        onWalEntry(lsn: number): void
        getState(): PersistenceState
      }

      await manager.createCheckpoint(0)

      for (let i = 1; i <= 10; i++) {
        manager.onWalEntry(i)
      }

      const state = manager.getState()

      expect(state.walEntriesSinceCheckpoint).toBe(10)
    })

    it('should reset entry count after checkpoint', async () => {
      const manager = null as unknown as {
        onWalEntry(lsn: number): void
        createCheckpoint(walPosition: number): Promise<Checkpoint>
        getState(): PersistenceState
      }

      for (let i = 1; i <= 10; i++) {
        manager.onWalEntry(i)
      }

      await manager.createCheckpoint(10)

      const state = manager.getState()

      expect(state.walEntriesSinceCheckpoint).toBe(0)
    })

    it('should track last checkpoint info', async () => {
      const manager = null as unknown as {
        createCheckpoint(walPosition: number): Promise<Checkpoint>
        getState(): PersistenceState
      }

      const checkpoint = await manager.createCheckpoint(100)

      const state = manager.getState()

      expect(state.lastCheckpoint?.id).toBe(checkpoint.id)
      expect(state.lastCheckpoint?.walPosition).toBe(100)
    })

    it('should track last snapshot info', async () => {
      const config: CheckpointConfig = { createSnapshots: true }
      const manager = null as unknown as {
        configure(config: CheckpointConfig): void
        createSnapshot(): Promise<StateSnapshot>
        getState(): PersistenceState
      }

      manager.configure(config)

      const snapshot = await manager.createSnapshot()

      const state = manager.getState()

      expect(state.lastSnapshot?.id).toBe(snapshot.id)
    })
  })
})
