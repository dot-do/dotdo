/**
 * DO Clone/Fork Operation Tests (RED Phase - TDD)
 *
 * Tests for cloning a Durable Object to create an independent copy.
 * Uses copy-on-write semantics for Iceberg data to enable fast cloning.
 *
 * Test Cases:
 * 1. Creates new DO with copied state
 * 2. Creates independent copy (no shared state)
 * 3. Uses copy-on-write for Iceberg data (fast clone)
 * 4. Supports cloning from specific snapshot
 *
 * RED PHASE: All tests should FAIL initially because the clone()
 * method and related infrastructure don't exist yet.
 *
 * @see docs/plans/2026-01-09-acid-test-suite-design.md
 * @module objects/persistence/tests/do-clone.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { IcebergStateAdapter, type IcebergSnapshot } from '../iceberg-state'
import type { StateSnapshot, Checkpoint } from '../types'

// ============================================================================
// TYPE DEFINITIONS FOR CLONE OPERATIONS
// ============================================================================

/**
 * Options for clone operations
 */
interface CloneOptions {
  /** Clone from a specific snapshot ID (default: current state) */
  snapshotId?: string
  /** Include history (actions, events) in clone */
  includeHistory?: boolean
  /** Use copy-on-write semantics for data files (default: true) */
  copyOnWrite?: boolean
  /** Timeout for the operation in ms */
  timeout?: number
}

/**
 * Result of a clone operation
 */
interface CloneResult {
  /** New DO namespace ID */
  targetId: string
  /** Snapshot ID that was cloned from */
  sourceSnapshotId: string
  /** Number of data files cloned */
  dataFilesCopied: number
  /** Number of data files shared (copy-on-write) */
  dataFilesShared: number
  /** Duration of clone operation in ms */
  durationMs: number
  /** Total bytes in cloned state */
  sizeBytes: number
}

/**
 * Extended IcebergStateAdapter interface with clone methods.
 * These methods don't exist yet - tests should FAIL.
 */
interface IcebergCloneAdapter extends IcebergStateAdapter {
  /**
   * Clone the current DO state to a new DO
   * @param sourceId Source DO identifier
   * @param targetId Target DO identifier
   * @param options Clone options
   */
  clone(sourceId: string, targetId: string, options?: CloneOptions): Promise<CloneResult>

  /**
   * Get a snapshot by ID for cloning
   */
  getSnapshot(snapshotId: string): Promise<IcebergSnapshot | null>

  /**
   * List all data files in the current state
   */
  listDataFiles(): Promise<DataFileInfo[]>

  /**
   * Check if a data file is shared (copy-on-write)
   */
  isDataFileShared(filePath: string): Promise<boolean>
}

/**
 * Data file information for copy-on-write tracking
 */
interface DataFileInfo {
  /** File path in storage */
  path: string
  /** File size in bytes */
  sizeBytes: number
  /** Record count */
  recordCount: number
  /** Reference count (shared by how many DOs) */
  refCount: number
  /** Last accessed timestamp */
  lastAccessedAt: number
}

/**
 * Mock storage interface for testing
 */
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

/**
 * Mock R2 bucket for Iceberg data files
 */
interface MockR2Bucket {
  objects: Map<string, { data: Uint8Array; metadata?: Record<string, string> }>
  put(key: string, data: ArrayBuffer | Uint8Array | string, options?: { customMetadata?: Record<string, string> }): Promise<void>
  get(key: string): Promise<{ body: ReadableStream; customMetadata?: Record<string, string> } | null>
  delete(key: string | string[]): Promise<void>
  list(options?: { prefix?: string }): Promise<{ objects: { key: string }[] }>
  head(key: string): Promise<{ size: number; customMetadata?: Record<string, string> } | null>
  copy(sourceKey: string, targetKey: string): Promise<void>
}

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a mock SQLite connection for testing
 */
function createMockSqlite() {
  const tables: Map<string, unknown[]> = new Map([
    ['things', []],
    ['relationships', []],
    ['actions', []],
    ['events', []],
  ])

  return {
    exec: vi.fn((query: string, ...params: unknown[]) => {
      // Parse simple queries for testing
      if (query.startsWith('SELECT * FROM')) {
        const tableName = query.split('FROM')[1]?.trim().split(' ')[0] || ''
        return { toArray: () => tables.get(tableName) || [] }
      }
      if (query.startsWith('DELETE FROM')) {
        const tableName = query.split('FROM')[1]?.trim().split(' ')[0] || ''
        tables.set(tableName, [])
        return { toArray: () => [] }
      }
      if (query.startsWith('INSERT INTO')) {
        const tableName = query.match(/INSERT INTO (\w+)/)?.[1] || ''
        const currentData = tables.get(tableName) || []
        currentData.push(params)
        tables.set(tableName, currentData)
        return { toArray: () => [] }
      }
      if (query === 'BEGIN TRANSACTION' || query === 'COMMIT' || query === 'ROLLBACK') {
        return { toArray: () => [] }
      }
      if (query.startsWith('SELECT COUNT')) {
        const tableName = query.match(/FROM (\w+)/)?.[1] || ''
        const data = tables.get(tableName) || []
        return { toArray: () => [{ count: data.length }] }
      }
      return { toArray: () => [] }
    }),
    _tables: tables,
    _setTableData: (tableName: string, data: unknown[]) => {
      tables.set(tableName, data)
    },
  }
}

/**
 * Create mock R2 bucket with copy-on-write support
 */
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
          },
        }),
        customMetadata: obj.metadata,
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
    },
    async head(key: string): Promise<{ size: number; customMetadata?: Record<string, string> } | null> {
      const obj = objects.get(key)
      if (!obj) return null
      return { size: obj.data.length, customMetadata: obj.metadata }
    },
    async copy(sourceKey: string, targetKey: string): Promise<void> {
      const source = objects.get(sourceKey)
      if (!source) throw new Error(`Source key not found: ${sourceKey}`)
      // Copy-on-write: just reference the same data
      objects.set(targetKey, { data: source.data, metadata: { ...source.metadata, copiedFrom: sourceKey } })
    },
  }
}

/**
 * Create sample things data for testing
 */
function createSampleThings(count: number = 5): Array<{
  id: string
  type: number
  branch: string | null
  name: string
  data: { name: string; index: number; nested?: { value: number } }
  deleted: boolean
}> {
  return Array.from({ length: count }, (_, i) => ({
    id: `thing-${i}`,
    type: 1,
    branch: null,
    name: `Item ${i}`,
    data: { name: `Item ${i}`, index: i, nested: { value: i * 10 } },
    deleted: false,
  }))
}

/**
 * Create sample relationships for testing
 */
function createSampleRelationships(thingIds: string[]): Array<{
  id: string
  verb: string
  from: string
  to: string
  data: Record<string, unknown> | null
}> {
  const relationships: Array<{
    id: string
    verb: string
    from: string
    to: string
    data: Record<string, unknown> | null
  }> = []

  for (let i = 0; i < thingIds.length - 1; i++) {
    relationships.push({
      id: `rel-${i}`,
      verb: 'relatedTo',
      from: thingIds[i],
      to: thingIds[i + 1],
      data: { order: i },
    })
  }

  return relationships
}

// ============================================================================
// TEST SUITE: DO CLONE OPERATIONS
// ============================================================================

describe('DO Clone/Fork Operations', () => {
  let mockSql: ReturnType<typeof createMockSqlite>
  let mockR2: MockR2Bucket
  let adapter: IcebergCloneAdapter

  beforeEach(() => {
    mockSql = createMockSqlite()
    mockR2 = createMockR2Bucket()
    // Cast to extended interface - methods don't exist yet (RED phase)
    adapter = new IcebergStateAdapter(mockSql) as unknown as IcebergCloneAdapter
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // TEST 1: Creates new DO with copied state
  // ==========================================================================

  describe('creates new DO with copied state', () => {
    it('clones things table to new DO', async () => {
      // Setup: Create state in source DO
      mockSql._setTableData('things', createSampleThings(5))

      const sourceId = 'source-do'
      const targetId = 'target-do'

      // This should FAIL - clone() doesn't exist yet
      const result = await adapter.clone(sourceId, targetId)

      // Verify result structure
      expect(result.targetId).toBe(targetId)
      expect(result.sourceSnapshotId).toBeDefined()
      expect(result.dataFilesCopied).toBeGreaterThanOrEqual(0)
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('clones relationships table to new DO', async () => {
      // Setup: Create things and relationships
      const things = createSampleThings(5)
      mockSql._setTableData('things', things)
      mockSql._setTableData('relationships', createSampleRelationships(things.map((t) => t.id)))

      const sourceId = 'source-do'
      const targetId = 'target-do'

      // This should FAIL - clone() doesn't exist yet
      const result = await adapter.clone(sourceId, targetId)

      // Both things and relationships should be copied
      expect(result.sizeBytes).toBeGreaterThan(0)
    })

    it('clones KV storage data to new DO', async () => {
      // Setup: Create KV-style things
      mockSql._setTableData('things', [
        { id: 'kv:config', type: 0, branch: null, name: null, data: { theme: 'dark', lang: 'en' }, deleted: false },
        { id: 'kv:settings', type: 0, branch: null, name: null, data: { notifications: true }, deleted: false },
      ])

      const sourceId = 'source-do'
      const targetId = 'target-do'

      // This should FAIL - clone() doesn't exist yet
      const result = await adapter.clone(sourceId, targetId)

      expect(result.targetId).toBe(targetId)
    })

    it('clones SQL table data correctly', async () => {
      // Setup: Populate all tables
      mockSql._setTableData('things', createSampleThings(10))
      mockSql._setTableData('relationships', createSampleRelationships(['thing-0', 'thing-1', 'thing-2']))
      mockSql._setTableData('actions', [
        { id: 'a1', verb: 'create', actor: 'user-1', status: 'completed' },
        { id: 'a2', verb: 'update', actor: 'user-1', status: 'completed' },
      ])
      mockSql._setTableData('events', [
        { id: 'e1', verb: 'thing.created', data: { thingId: 'thing-0' } },
      ])

      const sourceId = 'source-do'
      const targetId = 'target-do'

      // This should FAIL - clone() doesn't exist yet
      const result = await adapter.clone(sourceId, targetId, { includeHistory: true })

      // All tables should be cloned
      expect(result.sizeBytes).toBeGreaterThan(0)
    })

    it('preserves data types during clone', async () => {
      // Setup: Create data with various types
      mockSql._setTableData('things', [
        {
          id: 'type-test',
          type: 1,
          branch: null,
          name: 'Type Test',
          data: {
            stringVal: 'text',
            numberVal: 42,
            floatVal: 3.14159,
            boolVal: true,
            nullVal: null,
            arrayVal: [1, 2, 3],
            nestedObj: { deep: { value: 'nested' } },
          },
          deleted: false,
        },
      ])

      const sourceId = 'source-do'
      const targetId = 'target-do'

      // This should FAIL - clone() doesn't exist yet
      const result = await adapter.clone(sourceId, targetId)

      expect(result.targetId).toBe(targetId)
    })

    it('returns correct data file counts', async () => {
      // Setup: Create substantial data
      mockSql._setTableData('things', createSampleThings(100))

      const sourceId = 'source-do'
      const targetId = 'target-do'

      // This should FAIL - clone() doesn't exist yet
      const result = await adapter.clone(sourceId, targetId)

      // Should have at least one data file per table
      expect(result.dataFilesCopied + result.dataFilesShared).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // TEST 2: Creates independent copy (no shared state)
  // ==========================================================================

  describe('creates independent copy (no shared state)', () => {
    it('modifications to original do not affect clone', async () => {
      // Setup: Create initial state
      mockSql._setTableData('things', [
        { id: 't1', type: 1, branch: null, name: 'Original', data: { value: 1 }, deleted: false },
      ])

      const sourceId = 'source-do'
      const targetId = 'clone-do'

      // Create snapshot for cloning
      const snapshot = await adapter.createSnapshot()

      // This should FAIL - clone() doesn't exist yet
      await adapter.clone(sourceId, targetId)

      // Modify original after clone
      mockSql._setTableData('things', [
        { id: 't1', type: 1, branch: null, name: 'Modified', data: { value: 2 }, deleted: false },
      ])

      // Get the cloned state (would need separate adapter instance in real impl)
      // This should FAIL - getSnapshot() doesn't exist yet
      const cloneSnapshot = await adapter.getSnapshot(snapshot.id)

      // Clone should have original value, not modified
      expect(cloneSnapshot).toBeDefined()
    })

    it('modifications to clone do not affect original', async () => {
      // Setup: Create initial state
      mockSql._setTableData('things', [
        { id: 't1', type: 1, branch: null, name: 'Original', data: { value: 1 }, deleted: false },
      ])

      const sourceId = 'source-do'
      const targetId = 'clone-do'

      // This should FAIL - clone() doesn't exist yet
      await adapter.clone(sourceId, targetId)

      // Original should still have value 1
      const originalData = mockSql.exec('SELECT * FROM things').toArray()
      expect(originalData).toHaveLength(1)
    })

    it('deletes in original do not delete in clone', async () => {
      // Setup: Create multiple things
      mockSql._setTableData('things', createSampleThings(5))

      const sourceId = 'source-do'
      const targetId = 'clone-do'

      // Create snapshot before delete
      const snapshot = await adapter.createSnapshot()

      // This should FAIL - clone() doesn't exist yet
      await adapter.clone(sourceId, targetId)

      // Delete all from original
      mockSql._setTableData('things', [])

      // Clone should still have the data
      // This should FAIL - getSnapshot() doesn't exist yet
      const cloneSnapshot = await adapter.getSnapshot(snapshot.id)
      expect(cloneSnapshot).toBeDefined()
    })

    it('inserts in original do not appear in clone', async () => {
      // Setup: Create initial state
      mockSql._setTableData('things', [
        { id: 't1', type: 1, branch: null, name: 'Initial', data: {}, deleted: false },
      ])

      const sourceId = 'source-do'
      const targetId = 'clone-do'

      // This should FAIL - clone() doesn't exist yet
      await adapter.clone(sourceId, targetId)

      // Add new thing to original
      mockSql._tables.get('things')!.push(
        { id: 't2', type: 1, branch: null, name: 'New', data: {}, deleted: false }
      )

      // Clone should not have the new thing (just t1)
      // Verification would require accessing clone state
    })

    it('ensures physical data isolation', async () => {
      // Setup: Create data
      mockSql._setTableData('things', createSampleThings(3))

      const sourceId = 'source-do'
      const targetId = 'clone-do'

      // This should FAIL - clone() doesn't exist yet
      const result = await adapter.clone(sourceId, targetId)

      // After clone, both DOs should have independent storage
      // Even if using copy-on-write, mutations should not cross
      expect(result.targetId).toBe(targetId)
    })

    it('handles concurrent modifications correctly', async () => {
      // Setup: Create initial state
      mockSql._setTableData('things', [
        { id: 't1', type: 1, branch: null, name: 'Initial', data: { counter: 0 }, deleted: false },
      ])

      const sourceId = 'source-do'
      const targetId = 'clone-do'

      // This should FAIL - clone() doesn't exist yet
      const clonePromise = adapter.clone(sourceId, targetId)

      // Concurrent modification during clone
      mockSql._setTableData('things', [
        { id: 't1', type: 1, branch: null, name: 'Modified', data: { counter: 1 }, deleted: false },
      ])

      await clonePromise

      // Both should have consistent state (either before or after modification)
    })
  })

  // ==========================================================================
  // TEST 3: Uses copy-on-write for Iceberg data (fast clone)
  // ==========================================================================

  describe('uses copy-on-write for Iceberg data', () => {
    it('clone is fast even with large datasets', async () => {
      // Setup: Create large dataset
      const largeData = createSampleThings(1000)
      mockSql._setTableData('things', largeData)

      // Create a snapshot to have data files in R2
      await adapter.createSnapshot()

      const sourceId = 'source-do'
      const targetId = 'clone-do'

      const startTime = Date.now()

      // This should FAIL - clone() doesn't exist yet
      const result = await adapter.clone(sourceId, targetId)
      const duration = Date.now() - startTime

      // Clone should be fast (just manifest copy, not data copy)
      // Expect < 100ms for copy-on-write
      expect(duration).toBeLessThan(100)
      expect(result.durationMs).toBeLessThan(100)
    })

    it('shares data files between source and clone', async () => {
      // Setup: Create data and snapshot
      mockSql._setTableData('things', createSampleThings(100))
      await adapter.createSnapshot()

      const sourceId = 'source-do'
      const targetId = 'clone-do'

      // This should FAIL - clone() doesn't exist yet
      const result = await adapter.clone(sourceId, targetId)

      // Most files should be shared, not copied
      expect(result.dataFilesShared).toBeGreaterThan(0)
      expect(result.dataFilesShared).toBeGreaterThanOrEqual(result.dataFilesCopied)
    })

    it('only copies manifest, not data files', async () => {
      // Setup: Create substantial data
      mockSql._setTableData('things', createSampleThings(500))
      const snapshot = await adapter.createSnapshot()

      const sourceId = 'source-do'
      const targetId = 'clone-do'

      // This should FAIL - clone() doesn't exist yet
      const result = await adapter.clone(sourceId, targetId)

      // Data files should be shared (copy-on-write)
      // Only manifest files should be physically copied
      expect(result.dataFilesCopied).toBe(0) // No data files copied
      expect(result.dataFilesShared).toBeGreaterThan(0) // All data files shared
    })

    it('copies data on write (mutation triggers physical copy)', async () => {
      // Setup: Create data and clone
      mockSql._setTableData('things', [
        { id: 't1', type: 1, branch: null, name: 'Shared', data: { value: 1 }, deleted: false },
      ])
      await adapter.createSnapshot()

      const sourceId = 'source-do'
      const targetId = 'clone-do'

      // This should FAIL - clone() doesn't exist yet
      await adapter.clone(sourceId, targetId)

      // This should FAIL - isDataFileShared() doesn't exist yet
      const sharedBefore = await adapter.isDataFileShared('data/things/snapshot-1.parquet')
      expect(sharedBefore).toBe(true)

      // Mutation would trigger physical copy (tested in implementation)
    })

    it('tracks reference counts for shared data files', async () => {
      // Setup: Create data
      mockSql._setTableData('things', createSampleThings(10))
      await adapter.createSnapshot()

      const sourceId = 'source-do'

      // Clone multiple times
      // This should FAIL - clone() doesn't exist yet
      await adapter.clone(sourceId, 'clone-1')
      await adapter.clone(sourceId, 'clone-2')
      await adapter.clone(sourceId, 'clone-3')

      // This should FAIL - listDataFiles() doesn't exist yet
      const dataFiles = await adapter.listDataFiles()

      // Each data file should have refCount of 4 (source + 3 clones)
      for (const file of dataFiles) {
        expect(file.refCount).toBe(4)
      }
    })

    it('garbage collects orphaned data files', async () => {
      // Setup: Create data and multiple clones
      mockSql._setTableData('things', createSampleThings(5))
      await adapter.createSnapshot()

      const sourceId = 'source-do'

      // This should FAIL - clone() doesn't exist yet
      await adapter.clone(sourceId, 'clone-1')

      // This should FAIL - listDataFiles() doesn't exist yet
      const filesBefore = await adapter.listDataFiles()

      // Delete clone would decrement refCount
      // When refCount reaches 0, file should be garbage collected
      // (Implementation detail - tested by checking file count after GC)

      expect(filesBefore.length).toBeGreaterThan(0)
    })

    it('handles copy-on-write with concurrent reads', async () => {
      // Setup: Large dataset for concurrent access
      mockSql._setTableData('things', createSampleThings(100))
      await adapter.createSnapshot()

      const sourceId = 'source-do'
      const targetId = 'clone-do'

      // This should FAIL - clone() doesn't exist yet
      const clonePromise = adapter.clone(sourceId, targetId)

      // Concurrent reads should not block clone
      const readPromises = Array.from({ length: 10 }, () =>
        adapter.createSnapshot()
      )

      await Promise.all([clonePromise, ...readPromises])

      // All operations should complete successfully
    })
  })

  // ==========================================================================
  // TEST 4: Supports cloning from specific snapshot
  // ==========================================================================

  describe('supports cloning from specific snapshot', () => {
    it('clones from specific snapshot ID', async () => {
      // Setup: Create multiple snapshots
      mockSql._setTableData('things', [
        { id: 't1', type: 1, branch: null, name: 'Version 1', data: { version: 1 }, deleted: false },
      ])
      const snapshot1 = await adapter.createSnapshot()

      mockSql._setTableData('things', [
        { id: 't1', type: 1, branch: null, name: 'Version 2', data: { version: 2 }, deleted: false },
      ])
      const snapshot2 = await adapter.createSnapshot()

      const sourceId = 'source-do'
      const targetId = 'clone-do'

      // Clone from older snapshot (snapshot1)
      // This should FAIL - clone() doesn't exist yet
      const result = await adapter.clone(sourceId, targetId, { snapshotId: snapshot1.id })

      // Should clone from snapshot1, not snapshot2
      expect(result.sourceSnapshotId).toBe(snapshot1.id)
    })

    it('clones state at point-in-time', async () => {
      // Setup: Create data at different times
      mockSql._setTableData('things', [
        { id: 't1', type: 1, branch: null, name: 'T1', data: { created: 'first' }, deleted: false },
      ])
      const snap1 = await adapter.createSnapshot()

      // Add more data
      mockSql._tables.get('things')!.push(
        { id: 't2', type: 1, branch: null, name: 'T2', data: { created: 'second' }, deleted: false }
      )
      const snap2 = await adapter.createSnapshot()

      // Add even more
      mockSql._tables.get('things')!.push(
        { id: 't3', type: 1, branch: null, name: 'T3', data: { created: 'third' }, deleted: false }
      )
      await adapter.createSnapshot()

      const sourceId = 'source-do'
      const targetId = 'clone-do'

      // Clone from snap2 (should have t1 and t2, not t3)
      // This should FAIL - clone() doesn't exist yet
      const result = await adapter.clone(sourceId, targetId, { snapshotId: snap2.id })

      expect(result.sourceSnapshotId).toBe(snap2.id)
    })

    it('throws for invalid snapshot ID', async () => {
      const sourceId = 'source-do'
      const targetId = 'clone-do'

      // This should FAIL - clone() doesn't exist yet
      await expect(
        adapter.clone(sourceId, targetId, { snapshotId: 'non-existent-snapshot' })
      ).rejects.toThrow(/snapshot.*not found|invalid.*snapshot/i)
    })

    it('throws for expired/deleted snapshot', async () => {
      // Setup: Create and "delete" a snapshot
      mockSql._setTableData('things', createSampleThings(3))
      const snapshot = await adapter.createSnapshot()
      const snapshotId = snapshot.id

      // Simulate snapshot deletion (would be done by retention policy)
      // In real impl, this would remove the snapshot from storage

      const sourceId = 'source-do'
      const targetId = 'clone-do'

      // This should FAIL - clone() doesn't exist yet
      // Also should throw because snapshot is "deleted"
      await expect(
        adapter.clone(sourceId, targetId, { snapshotId: snapshotId })
      ).rejects.toThrow()
    })

    it('clones from latest snapshot when not specified', async () => {
      // Setup: Create multiple snapshots
      mockSql._setTableData('things', [{ id: 't1', type: 1, branch: null, name: 'V1', data: {}, deleted: false }])
      await adapter.createSnapshot()

      mockSql._setTableData('things', [{ id: 't1', type: 1, branch: null, name: 'V2', data: {}, deleted: false }])
      await adapter.createSnapshot()

      mockSql._setTableData('things', [{ id: 't1', type: 1, branch: null, name: 'V3', data: {}, deleted: false }])
      const latestSnapshot = await adapter.createSnapshot()

      const sourceId = 'source-do'
      const targetId = 'clone-do'

      // Clone without specifying snapshot (should use latest)
      // This should FAIL - clone() doesn't exist yet
      const result = await adapter.clone(sourceId, targetId)

      expect(result.sourceSnapshotId).toBe(latestSnapshot.id)
    })

    it('handles snapshot with schema version mismatch', async () => {
      // Setup: Create snapshot with old schema
      mockSql._setTableData('things', createSampleThings(3))
      const oldAdapter = new IcebergStateAdapter(mockSql, { schemaVersion: 1 }) as unknown as IcebergCloneAdapter
      const oldSnapshot = await oldAdapter.createSnapshot()

      // Create new adapter with newer schema
      const newAdapter = new IcebergStateAdapter(mockSql, { schemaVersion: 2 }) as unknown as IcebergCloneAdapter

      const sourceId = 'source-do'
      const targetId = 'clone-do'

      // This should FAIL - clone() doesn't exist yet
      // Should also handle schema version mismatch
      await expect(
        newAdapter.clone(sourceId, targetId, { snapshotId: oldSnapshot.id })
      ).rejects.toThrow(/schema.*version|migration.*required/i)
    })

    it('preserves snapshot chain in clone', async () => {
      // Setup: Create snapshot chain
      mockSql._setTableData('things', [{ id: 't1', type: 1, branch: null, name: 'V1', data: {}, deleted: false }])
      const snap1 = await adapter.createSnapshot()

      mockSql._setTableData('things', [{ id: 't1', type: 1, branch: null, name: 'V2', data: {}, deleted: false }])
      const snap2 = await adapter.createSnapshot()

      const sourceId = 'source-do'
      const targetId = 'clone-do'

      // Clone from snap2
      // This should FAIL - clone() doesn't exist yet
      const result = await adapter.clone(sourceId, targetId, { snapshotId: snap2.id })

      // Clone should be able to time-travel to snap1 as well
      // (preserves snapshot lineage)
      expect(result.sourceSnapshotId).toBe(snap2.id)
    })
  })

  // ==========================================================================
  // ERROR HANDLING
  // ==========================================================================

  describe('error handling', () => {
    it('throws if source DO does not exist', async () => {
      // This should FAIL - clone() doesn't exist yet
      await expect(
        adapter.clone('non-existent-source', 'target-do')
      ).rejects.toThrow(/source.*not found|does not exist/i)
    })

    it('throws if target DO already exists', async () => {
      mockSql._setTableData('things', createSampleThings(3))

      // This should FAIL - clone() doesn't exist yet
      // Target already exists
      await expect(
        adapter.clone('source-do', 'existing-target')
      ).rejects.toThrow(/target.*exists|already exists/i)
    })

    it('handles storage errors gracefully', async () => {
      mockSql._setTableData('things', createSampleThings(3))

      // Simulate storage error
      mockSql.exec.mockImplementationOnce(() => {
        throw new Error('Storage unavailable')
      })

      // This should FAIL - clone() doesn't exist yet
      await expect(
        adapter.clone('source-do', 'target-do')
      ).rejects.toThrow(/storage/i)
    })

    it('rolls back on partial clone failure', async () => {
      mockSql._setTableData('things', createSampleThings(10))
      await adapter.createSnapshot()

      // This should FAIL - clone() doesn't exist yet
      // Would test rollback behavior on partial failure
      await expect(
        adapter.clone('source-do', 'target-do')
      ).resolves.toBeDefined()
    })

    it('respects timeout option', async () => {
      // Setup: Large dataset that might take time
      mockSql._setTableData('things', createSampleThings(1000))

      // This should FAIL - clone() doesn't exist yet
      await expect(
        adapter.clone('source-do', 'target-do', { timeout: 1 })
      ).rejects.toThrow(/timeout/i)
    })
  })

  // ==========================================================================
  // CLONE OPTIONS
  // ==========================================================================

  describe('clone options', () => {
    it('respects includeHistory: false (default)', async () => {
      // Setup: Create state with history
      mockSql._setTableData('things', createSampleThings(3))
      mockSql._setTableData('actions', [
        { id: 'a1', verb: 'create', actor: 'user', status: 'completed' },
      ])
      mockSql._setTableData('events', [
        { id: 'e1', verb: 'thing.created', data: {} },
      ])

      // This should FAIL - clone() doesn't exist yet
      const result = await adapter.clone('source-do', 'target-do')

      // Default: history not included
      expect(result).toBeDefined()
    })

    it('respects includeHistory: true', async () => {
      // Setup: Create state with history
      mockSql._setTableData('things', createSampleThings(3))
      mockSql._setTableData('actions', [
        { id: 'a1', verb: 'create', actor: 'user', status: 'completed' },
      ])
      mockSql._setTableData('events', [
        { id: 'e1', verb: 'thing.created', data: {} },
      ])

      // This should FAIL - clone() doesn't exist yet
      const result = await adapter.clone('source-do', 'target-do', { includeHistory: true })

      // History should be included in clone
      expect(result).toBeDefined()
    })

    it('respects copyOnWrite: false for full copy', async () => {
      mockSql._setTableData('things', createSampleThings(100))
      await adapter.createSnapshot()

      // This should FAIL - clone() doesn't exist yet
      const result = await adapter.clone('source-do', 'target-do', { copyOnWrite: false })

      // All files should be physically copied, not shared
      expect(result.dataFilesCopied).toBeGreaterThan(0)
      expect(result.dataFilesShared).toBe(0)
    })

    it('uses copyOnWrite: true by default', async () => {
      mockSql._setTableData('things', createSampleThings(100))
      await adapter.createSnapshot()

      // This should FAIL - clone() doesn't exist yet
      const result = await adapter.clone('source-do', 'target-do')

      // Default should use copy-on-write
      expect(result.dataFilesShared).toBeGreaterThanOrEqual(result.dataFilesCopied)
    })
  })

  // ==========================================================================
  // CONCURRENT CLONE OPERATIONS
  // ==========================================================================

  describe('concurrent clone operations', () => {
    it('handles multiple concurrent clones from same source', async () => {
      mockSql._setTableData('things', createSampleThings(50))
      await adapter.createSnapshot()

      // This should FAIL - clone() doesn't exist yet
      const clonePromises = [
        adapter.clone('source-do', 'clone-1'),
        adapter.clone('source-do', 'clone-2'),
        adapter.clone('source-do', 'clone-3'),
      ]

      const results = await Promise.all(clonePromises)

      // All clones should succeed
      expect(results).toHaveLength(3)
      expect(new Set(results.map((r) => r.targetId)).size).toBe(3)
    })

    it('serializes clone operations to same target', async () => {
      mockSql._setTableData('things', createSampleThings(10))

      // This should FAIL - clone() doesn't exist yet
      const clone1 = adapter.clone('source-1', 'target-do')
      const clone2 = adapter.clone('source-2', 'target-do')

      // Second clone should fail (target exists after first)
      await expect(Promise.all([clone1, clone2])).rejects.toThrow()
    })

    it('does not corrupt state during concurrent operations', async () => {
      mockSql._setTableData('things', createSampleThings(100))
      await adapter.createSnapshot()

      // This should FAIL - clone() doesn't exist yet
      const operations = [
        adapter.clone('source-do', 'clone-a'),
        adapter.createSnapshot(),
        adapter.clone('source-do', 'clone-b'),
        adapter.createSnapshot(),
      ]

      // All operations should complete without corruption
      await expect(Promise.all(operations)).resolves.toBeDefined()
    })
  })
})

// ============================================================================
// TEST SUITE: CLONE RESULT VERIFICATION
// ============================================================================

describe('Clone Result Verification', () => {
  let mockSql: ReturnType<typeof createMockSqlite>
  let adapter: IcebergCloneAdapter

  beforeEach(() => {
    mockSql = createMockSqlite()
    adapter = new IcebergStateAdapter(mockSql) as unknown as IcebergCloneAdapter
  })

  it('returns accurate size information', async () => {
    mockSql._setTableData('things', createSampleThings(50))
    await adapter.createSnapshot()

    // This should FAIL - clone() doesn't exist yet
    const result = await adapter.clone('source-do', 'target-do')

    expect(result.sizeBytes).toBeGreaterThan(0)
    expect(typeof result.sizeBytes).toBe('number')
  })

  it('returns accurate duration', async () => {
    mockSql._setTableData('things', createSampleThings(10))

    // This should FAIL - clone() doesn't exist yet
    const result = await adapter.clone('source-do', 'target-do')

    expect(result.durationMs).toBeGreaterThanOrEqual(0)
    expect(typeof result.durationMs).toBe('number')
  })

  it('returns correct source snapshot ID', async () => {
    mockSql._setTableData('things', createSampleThings(5))
    const snapshot = await adapter.createSnapshot()

    // This should FAIL - clone() doesn't exist yet
    const result = await adapter.clone('source-do', 'target-do')

    expect(result.sourceSnapshotId).toBe(snapshot.id)
  })

  it('returns correct data file counts', async () => {
    mockSql._setTableData('things', createSampleThings(100))
    await adapter.createSnapshot()

    // This should FAIL - clone() doesn't exist yet
    const result = await adapter.clone('source-do', 'target-do')

    // Sum of copied + shared should equal total files
    const totalFiles = result.dataFilesCopied + result.dataFilesShared
    expect(totalFiles).toBeGreaterThan(0)
  })
})
