/**
 * DO Clone/Fork Operation Tests (RED Phase - TDD)
 *
 * Tests for cloning a Durable Object to create an independent copy.
 * Uses copy-on-write semantics for Iceberg data to enable fast cloning.
 *
 * Test Cases:
 * 1. Full DO clone - Complete state replication
 * 2. Selective cloning - Filter specific tables/data
 * 3. Cross-namespace clone - Clone between different namespaces
 * 4. Clone validation - Pre-flight checks and integrity
 * 5. State isolation - Independent mutation after clone
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
  /** Selective cloning: only include these tables */
  includeTables?: string[]
  /** Selective cloning: exclude these tables */
  excludeTables?: string[]
  /** Filter predicate for rows (applied per-table) */
  rowFilter?: Record<string, (row: unknown) => boolean>
  /** Target namespace for cross-namespace cloning */
  targetNamespace?: string
  /** Validate schema compatibility before clone */
  validateSchema?: boolean
  /** Preserve source references for lineage tracking */
  preserveLineage?: boolean
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
  /** Tables that were cloned */
  tablesCloned: string[]
  /** Tables that were skipped (if selective) */
  tablesSkipped?: string[]
  /** Number of rows cloned per table */
  rowCounts: Record<string, number>
  /** Source namespace (for cross-namespace) */
  sourceNamespace?: string
  /** Lineage reference if preserved */
  lineage?: {
    sourceDoId: string
    sourceSnapshotId: string
    clonedAt: number
    depth: number
  }
}

/**
 * Clone validation result
 */
interface CloneValidationResult {
  /** Whether clone would succeed */
  valid: boolean
  /** Validation error if any */
  error?: string
  /** Warnings (non-blocking issues) */
  warnings: string[]
  /** Source snapshot details */
  sourceSnapshot?: {
    id: string
    schemaVersion: number
    tableCount: number
    totalRows: number
    sizeBytes: number
  }
  /** Schema compatibility status */
  schemaCompatible?: boolean
  /** Estimated clone duration */
  estimatedDurationMs?: number
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

  /**
   * Validate a clone operation before executing
   */
  validateClone(sourceId: string, targetId: string, options?: CloneOptions): Promise<CloneValidationResult>

  /**
   * Get the lineage chain for a cloned DO
   */
  getLineageChain(doId: string): Promise<Array<{ doId: string; snapshotId: string; clonedAt: number }>>

  /**
   * Clone with selective table filtering
   */
  cloneSelective(
    sourceId: string,
    targetId: string,
    tables: string[],
    options?: Omit<CloneOptions, 'includeTables'>
  ): Promise<CloneResult>

  /**
   * Clone across namespaces
   */
  cloneCrossNamespace(
    sourceNs: string,
    sourceId: string,
    targetNs: string,
    targetId: string,
    options?: CloneOptions
  ): Promise<CloneResult>
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

// ============================================================================
// TEST SUITE: SELECTIVE CLONING
// ============================================================================

describe('Selective Cloning', () => {
  let mockSql: ReturnType<typeof createMockSqlite>
  let adapter: IcebergCloneAdapter

  beforeEach(() => {
    mockSql = createMockSqlite()
    adapter = new IcebergStateAdapter(mockSql) as unknown as IcebergCloneAdapter
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ---------------------------------------------------------------------------
  // Include specific tables
  // ---------------------------------------------------------------------------
  describe('includeTables option', () => {
    it('clones only specified tables', async () => {
      // Setup all tables with data
      mockSql._setTableData('things', createSampleThings(10))
      mockSql._setTableData('relationships', createSampleRelationships(['t-0', 't-1', 't-2']))
      mockSql._setTableData('actions', [{ id: 'a1', verb: 'create' }])
      mockSql._setTableData('events', [{ id: 'e1', verb: 'created' }])

      // This should FAIL - clone() doesn't exist yet
      const result = await adapter.clone('source-do', 'target-do', {
        includeTables: ['things', 'relationships'],
      })

      // Only things and relationships should be cloned
      expect(result.tablesCloned).toContain('things')
      expect(result.tablesCloned).toContain('relationships')
      expect(result.tablesCloned).not.toContain('actions')
      expect(result.tablesCloned).not.toContain('events')
    })

    it('returns skipped tables in result', async () => {
      mockSql._setTableData('things', createSampleThings(5))
      mockSql._setTableData('actions', [{ id: 'a1' }])

      // This should FAIL - clone() doesn't exist yet
      const result = await adapter.clone('source-do', 'target-do', {
        includeTables: ['things'],
      })

      expect(result.tablesSkipped).toBeDefined()
      expect(result.tablesSkipped).toContain('actions')
    })

    it('clones single table when specified', async () => {
      mockSql._setTableData('things', createSampleThings(20))
      mockSql._setTableData('relationships', createSampleRelationships(['t-0', 't-1']))

      // This should FAIL - clone() doesn't exist yet
      const result = await adapter.clone('source-do', 'target-do', {
        includeTables: ['things'],
      })

      expect(result.tablesCloned).toEqual(['things'])
      expect(result.rowCounts['things']).toBe(20)
    })

    it('handles empty includeTables array (clones nothing)', async () => {
      mockSql._setTableData('things', createSampleThings(5))

      // This should FAIL - clone() doesn't exist yet
      const result = await adapter.clone('source-do', 'target-do', {
        includeTables: [],
      })

      expect(result.tablesCloned).toHaveLength(0)
      expect(result.sizeBytes).toBe(0)
    })

    it('throws for non-existent table in includeTables', async () => {
      mockSql._setTableData('things', createSampleThings(5))

      // This should FAIL - clone() doesn't exist yet
      await expect(
        adapter.clone('source-do', 'target-do', {
          includeTables: ['things', 'nonexistent_table'],
        })
      ).rejects.toThrow(/table.*not found|unknown.*table/i)
    })
  })

  // ---------------------------------------------------------------------------
  // Exclude specific tables
  // ---------------------------------------------------------------------------
  describe('excludeTables option', () => {
    it('excludes specified tables from clone', async () => {
      mockSql._setTableData('things', createSampleThings(10))
      mockSql._setTableData('relationships', createSampleRelationships(['t-0', 't-1']))
      mockSql._setTableData('actions', [{ id: 'a1' }])
      mockSql._setTableData('events', [{ id: 'e1' }])

      // This should FAIL - clone() doesn't exist yet
      const result = await adapter.clone('source-do', 'target-do', {
        excludeTables: ['actions', 'events'],
      })

      expect(result.tablesCloned).toContain('things')
      expect(result.tablesCloned).toContain('relationships')
      expect(result.tablesCloned).not.toContain('actions')
      expect(result.tablesCloned).not.toContain('events')
    })

    it('excludes single table', async () => {
      mockSql._setTableData('things', createSampleThings(5))
      mockSql._setTableData('relationships', createSampleRelationships(['t-0', 't-1']))

      // This should FAIL - clone() doesn't exist yet
      const result = await adapter.clone('source-do', 'target-do', {
        excludeTables: ['relationships'],
      })

      expect(result.tablesCloned).toContain('things')
      expect(result.tablesCloned).not.toContain('relationships')
    })

    it('ignores non-existent tables in excludeTables', async () => {
      mockSql._setTableData('things', createSampleThings(5))

      // This should FAIL - clone() doesn't exist yet
      // Non-existent tables in exclude should be silently ignored
      const result = await adapter.clone('source-do', 'target-do', {
        excludeTables: ['nonexistent_table'],
      })

      expect(result.tablesCloned).toContain('things')
    })
  })

  // ---------------------------------------------------------------------------
  // Row filtering
  // ---------------------------------------------------------------------------
  describe('rowFilter option', () => {
    it('filters rows during clone', async () => {
      mockSql._setTableData('things', [
        { id: 't1', type: 1, data: { status: 'active' } },
        { id: 't2', type: 1, data: { status: 'inactive' } },
        { id: 't3', type: 1, data: { status: 'active' } },
      ])

      // This should FAIL - clone() doesn't exist yet
      const result = await adapter.clone('source-do', 'target-do', {
        rowFilter: {
          things: (row: any) => row.data?.status === 'active',
        },
      })

      expect(result.rowCounts['things']).toBe(2) // Only active rows
    })

    it('applies different filters per table', async () => {
      mockSql._setTableData('things', [
        { id: 't1', type: 1, data: { value: 10 } },
        { id: 't2', type: 1, data: { value: 50 } },
        { id: 't3', type: 1, data: { value: 100 } },
      ])
      mockSql._setTableData('actions', [
        { id: 'a1', status: 'completed' },
        { id: 'a2', status: 'pending' },
      ])

      // This should FAIL - clone() doesn't exist yet
      const result = await adapter.clone('source-do', 'target-do', {
        rowFilter: {
          things: (row: any) => row.data?.value > 20,
          actions: (row: any) => row.status === 'completed',
        },
      })

      expect(result.rowCounts['things']).toBe(2) // t2 and t3
      expect(result.rowCounts['actions']).toBe(1) // Only completed
    })

    it('includes all rows for tables without filter', async () => {
      mockSql._setTableData('things', createSampleThings(10))
      mockSql._setTableData('relationships', createSampleRelationships(['t-0', 't-1']))

      // This should FAIL - clone() doesn't exist yet
      const result = await adapter.clone('source-do', 'target-do', {
        rowFilter: {
          things: (row: any) => row.id === 'thing-0', // Only one thing
        },
      })

      expect(result.rowCounts['things']).toBe(1)
      // Relationships should have all rows (no filter)
    })

    it('handles filter that matches no rows', async () => {
      mockSql._setTableData('things', createSampleThings(10))

      // This should FAIL - clone() doesn't exist yet
      const result = await adapter.clone('source-do', 'target-do', {
        rowFilter: {
          things: () => false, // Match nothing
        },
      })

      expect(result.rowCounts['things']).toBe(0)
    })

    it('handles filter errors gracefully', async () => {
      mockSql._setTableData('things', createSampleThings(5))

      // This should FAIL - clone() doesn't exist yet
      await expect(
        adapter.clone('source-do', 'target-do', {
          rowFilter: {
            things: () => {
              throw new Error('Filter error')
            },
          },
        })
      ).rejects.toThrow(/filter.*error/i)
    })
  })

  // ---------------------------------------------------------------------------
  // cloneSelective method
  // ---------------------------------------------------------------------------
  describe('cloneSelective method', () => {
    it('provides shorthand for table selection', async () => {
      mockSql._setTableData('things', createSampleThings(10))
      mockSql._setTableData('relationships', createSampleRelationships(['t-0', 't-1']))
      mockSql._setTableData('actions', [{ id: 'a1' }])

      // This should FAIL - cloneSelective() doesn't exist yet
      const result = await adapter.cloneSelective('source-do', 'target-do', ['things', 'relationships'])

      expect(result.tablesCloned).toHaveLength(2)
      expect(result.tablesCloned).toContain('things')
      expect(result.tablesCloned).toContain('relationships')
    })

    it('combines with other options', async () => {
      mockSql._setTableData('things', createSampleThings(5))

      // This should FAIL - cloneSelective() doesn't exist yet
      const result = await adapter.cloneSelective('source-do', 'target-do', ['things'], {
        copyOnWrite: false,
      })

      expect(result.dataFilesShared).toBe(0)
      expect(result.dataFilesCopied).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// TEST SUITE: CROSS-NAMESPACE CLONING
// ============================================================================

describe('Cross-Namespace Cloning', () => {
  let mockSql: ReturnType<typeof createMockSqlite>
  let adapter: IcebergCloneAdapter

  beforeEach(() => {
    mockSql = createMockSqlite()
    adapter = new IcebergStateAdapter(mockSql) as unknown as IcebergCloneAdapter
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ---------------------------------------------------------------------------
  // Basic cross-namespace operations
  // ---------------------------------------------------------------------------
  describe('basic cross-namespace clone', () => {
    it('clones from one namespace to another', async () => {
      mockSql._setTableData('things', createSampleThings(10))

      // This should FAIL - cloneCrossNamespace() doesn't exist yet
      const result = await adapter.cloneCrossNamespace(
        'production',
        'source-do',
        'staging',
        'target-do'
      )

      expect(result.sourceNamespace).toBe('production')
      expect(result.targetId).toBe('target-do')
    })

    it('preserves source namespace in result', async () => {
      mockSql._setTableData('things', createSampleThings(5))

      // This should FAIL - cloneCrossNamespace() doesn't exist yet
      const result = await adapter.cloneCrossNamespace(
        'tenant-a',
        'database',
        'tenant-b',
        'database-copy'
      )

      expect(result.sourceNamespace).toBe('tenant-a')
    })

    it('handles deeply nested namespaces', async () => {
      mockSql._setTableData('things', createSampleThings(5))

      // This should FAIL - cloneCrossNamespace() doesn't exist yet
      const result = await adapter.cloneCrossNamespace(
        'org/team/env/region',
        'source-do',
        'org/team/backup/region',
        'backup-do'
      )

      expect(result.targetId).toBe('backup-do')
      expect(result.sourceNamespace).toBe('org/team/env/region')
    })

    it('handles special characters in namespace', async () => {
      mockSql._setTableData('things', createSampleThings(3))

      // This should FAIL - cloneCrossNamespace() doesn't exist yet
      const result = await adapter.cloneCrossNamespace(
        'user:123/project_alpha',
        'data',
        'user:456/project_beta',
        'data-clone'
      )

      expect(result.sourceNamespace).toBe('user:123/project_alpha')
    })
  })

  // ---------------------------------------------------------------------------
  // Cross-namespace with targetNamespace option
  // ---------------------------------------------------------------------------
  describe('targetNamespace option in clone()', () => {
    it('allows cross-namespace via clone options', async () => {
      mockSql._setTableData('things', createSampleThings(10))

      // This should FAIL - clone() doesn't exist yet
      const result = await adapter.clone('source-do', 'target-do', {
        targetNamespace: 'different-namespace',
      })

      expect(result.targetId).toBe('target-do')
    })

    it('defaults to same namespace when not specified', async () => {
      mockSql._setTableData('things', createSampleThings(5))

      // This should FAIL - clone() doesn't exist yet
      const result = await adapter.clone('source-do', 'target-do')

      // No cross-namespace, so sourceNamespace should be undefined or same
      expect(result.sourceNamespace).toBeUndefined()
    })
  })

  // ---------------------------------------------------------------------------
  // Environment-based cloning
  // ---------------------------------------------------------------------------
  describe('environment cloning patterns', () => {
    it('clones from production to staging', async () => {
      mockSql._setTableData('things', createSampleThings(100))
      mockSql._setTableData('actions', [{ id: 'a1', status: 'completed' }])

      // This should FAIL - cloneCrossNamespace() doesn't exist yet
      const result = await adapter.cloneCrossNamespace(
        'production',
        'users.do',
        'staging',
        'users.do'
      )

      expect(result.sourceNamespace).toBe('production')
    })

    it('clones from staging to development', async () => {
      mockSql._setTableData('things', createSampleThings(50))

      // This should FAIL - cloneCrossNamespace() doesn't exist yet
      const result = await adapter.cloneCrossNamespace(
        'staging',
        'orders.do',
        'development',
        'orders.do'
      )

      expect(result.sourceNamespace).toBe('staging')
    })

    it('clones for tenant isolation testing', async () => {
      mockSql._setTableData('things', createSampleThings(20))

      // This should FAIL - cloneCrossNamespace() doesn't exist yet
      const result = await adapter.cloneCrossNamespace(
        'tenant-acme',
        'crm.do',
        'tenant-test',
        'crm.do'
      )

      expect(result.sourceNamespace).toBe('tenant-acme')
    })
  })

  // ---------------------------------------------------------------------------
  // Cross-namespace permissions and validation
  // ---------------------------------------------------------------------------
  describe('cross-namespace validation', () => {
    it('validates source namespace exists', async () => {
      // This should FAIL - cloneCrossNamespace() doesn't exist yet
      await expect(
        adapter.cloneCrossNamespace(
          'nonexistent-ns',
          'source-do',
          'target-ns',
          'target-do'
        )
      ).rejects.toThrow(/namespace.*not found|source.*not found/i)
    })

    it('validates target namespace is writable', async () => {
      mockSql._setTableData('things', createSampleThings(5))

      // This should FAIL - cloneCrossNamespace() doesn't exist yet
      // Simulating read-only namespace
      await expect(
        adapter.cloneCrossNamespace(
          'source-ns',
          'source-do',
          'readonly-ns',
          'target-do'
        )
      ).rejects.toThrow(/readonly|permission|not writable/i)
    })
  })

  // ---------------------------------------------------------------------------
  // Lineage tracking across namespaces
  // ---------------------------------------------------------------------------
  describe('cross-namespace lineage', () => {
    it('tracks lineage across namespace boundaries', async () => {
      mockSql._setTableData('things', createSampleThings(10))

      // This should FAIL - cloneCrossNamespace() doesn't exist yet
      const result = await adapter.cloneCrossNamespace(
        'production',
        'source-do',
        'staging',
        'target-do',
        { preserveLineage: true }
      )

      expect(result.lineage).toBeDefined()
      expect(result.lineage!.sourceDoId).toBe('source-do')
    })

    it('builds lineage chain for multi-hop clones', async () => {
      mockSql._setTableData('things', createSampleThings(5))

      // First clone: prod -> staging
      await adapter.cloneCrossNamespace(
        'production',
        'original',
        'staging',
        'staging-copy',
        { preserveLineage: true }
      )

      // Second clone: staging -> dev
      await adapter.cloneCrossNamespace(
        'staging',
        'staging-copy',
        'development',
        'dev-copy',
        { preserveLineage: true }
      )

      // This should FAIL - getLineageChain() doesn't exist yet
      const chain = await adapter.getLineageChain('dev-copy')

      expect(chain.length).toBeGreaterThanOrEqual(2)
    })
  })
})

// ============================================================================
// TEST SUITE: CLONE VALIDATION
// ============================================================================

describe('Clone Validation', () => {
  let mockSql: ReturnType<typeof createMockSqlite>
  let adapter: IcebergCloneAdapter

  beforeEach(() => {
    mockSql = createMockSqlite()
    adapter = new IcebergStateAdapter(mockSql) as unknown as IcebergCloneAdapter
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ---------------------------------------------------------------------------
  // Pre-flight validation
  // ---------------------------------------------------------------------------
  describe('validateClone method', () => {
    it('returns valid=true for valid clone operation', async () => {
      mockSql._setTableData('things', createSampleThings(10))
      await adapter.createSnapshot()

      // This should FAIL - validateClone() doesn't exist yet
      const result = await adapter.validateClone('source-do', 'target-do')

      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('returns valid=false when source does not exist', async () => {
      // This should FAIL - validateClone() doesn't exist yet
      const result = await adapter.validateClone('nonexistent-source', 'target-do')

      expect(result.valid).toBe(false)
      expect(result.error).toContain('not found')
    })

    it('returns valid=false when target already exists', async () => {
      mockSql._setTableData('things', createSampleThings(5))

      // This should FAIL - validateClone() doesn't exist yet
      const result = await adapter.validateClone('source-do', 'existing-target')

      expect(result.valid).toBe(false)
      expect(result.error).toContain('already exists')
    })

    it('returns source snapshot details', async () => {
      mockSql._setTableData('things', createSampleThings(20))
      const snapshot = await adapter.createSnapshot()

      // This should FAIL - validateClone() doesn't exist yet
      const result = await adapter.validateClone('source-do', 'target-do')

      expect(result.sourceSnapshot).toBeDefined()
      expect(result.sourceSnapshot!.id).toBe(snapshot.id)
      expect(result.sourceSnapshot!.totalRows).toBe(20)
    })

    it('provides warnings for non-blocking issues', async () => {
      mockSql._setTableData('things', createSampleThings(1000))
      await adapter.createSnapshot()

      // This should FAIL - validateClone() doesn't exist yet
      const result = await adapter.validateClone('source-do', 'target-do')

      expect(result.warnings).toBeDefined()
      expect(Array.isArray(result.warnings)).toBe(true)
    })

    it('estimates clone duration', async () => {
      mockSql._setTableData('things', createSampleThings(500))
      await adapter.createSnapshot()

      // This should FAIL - validateClone() doesn't exist yet
      const result = await adapter.validateClone('source-do', 'target-do')

      expect(result.estimatedDurationMs).toBeDefined()
      expect(typeof result.estimatedDurationMs).toBe('number')
    })
  })

  // ---------------------------------------------------------------------------
  // Schema validation
  // ---------------------------------------------------------------------------
  describe('schema validation', () => {
    it('validates schema compatibility', async () => {
      mockSql._setTableData('things', createSampleThings(10))
      await adapter.createSnapshot()

      // This should FAIL - validateClone() doesn't exist yet
      const result = await adapter.validateClone('source-do', 'target-do', {
        validateSchema: true,
      })

      expect(result.schemaCompatible).toBe(true)
    })

    it('detects schema version mismatch', async () => {
      mockSql._setTableData('things', createSampleThings(5))
      const oldAdapter = new IcebergStateAdapter(mockSql, { schemaVersion: 1 }) as unknown as IcebergCloneAdapter
      await oldAdapter.createSnapshot()

      const newAdapter = new IcebergStateAdapter(mockSql, { schemaVersion: 3 }) as unknown as IcebergCloneAdapter

      // This should FAIL - validateClone() doesn't exist yet
      const result = await newAdapter.validateClone('source-do', 'target-do', {
        validateSchema: true,
      })

      expect(result.schemaCompatible).toBe(false)
      expect(result.warnings).toContain(expect.stringMatching(/schema.*version/i))
    })

    it('warns about large row counts', async () => {
      // Simulate large dataset
      mockSql._setTableData('things', createSampleThings(10000))
      await adapter.createSnapshot()

      // This should FAIL - validateClone() doesn't exist yet
      const result = await adapter.validateClone('source-do', 'target-do')

      expect(result.warnings.some((w) => w.includes('large') || w.includes('rows'))).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // Snapshot-specific validation
  // ---------------------------------------------------------------------------
  describe('snapshot validation', () => {
    it('validates specific snapshot exists', async () => {
      mockSql._setTableData('things', createSampleThings(5))
      const snapshot = await adapter.createSnapshot()

      // This should FAIL - validateClone() doesn't exist yet
      const result = await adapter.validateClone('source-do', 'target-do', {
        snapshotId: snapshot.id,
      })

      expect(result.valid).toBe(true)
    })

    it('fails validation for non-existent snapshot', async () => {
      mockSql._setTableData('things', createSampleThings(5))
      await adapter.createSnapshot()

      // This should FAIL - validateClone() doesn't exist yet
      const result = await adapter.validateClone('source-do', 'target-do', {
        snapshotId: 'nonexistent-snapshot-id',
      })

      expect(result.valid).toBe(false)
      expect(result.error).toContain('snapshot')
    })

    it('validates snapshot integrity (checksum)', async () => {
      mockSql._setTableData('things', createSampleThings(10))
      await adapter.createSnapshot()

      // This should FAIL - validateClone() doesn't exist yet
      const result = await adapter.validateClone('source-do', 'target-do')

      // Validation should check checksum integrity
      expect(result.valid).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // Selective clone validation
  // ---------------------------------------------------------------------------
  describe('selective clone validation', () => {
    it('validates includeTables exist', async () => {
      mockSql._setTableData('things', createSampleThings(5))
      await adapter.createSnapshot()

      // This should FAIL - validateClone() doesn't exist yet
      const result = await adapter.validateClone('source-do', 'target-do', {
        includeTables: ['things', 'nonexistent_table'],
      })

      expect(result.valid).toBe(false)
      expect(result.error).toContain('nonexistent_table')
    })

    it('validates row filter functions', async () => {
      mockSql._setTableData('things', createSampleThings(5))
      await adapter.createSnapshot()

      // This should FAIL - validateClone() doesn't exist yet
      const result = await adapter.validateClone('source-do', 'target-do', {
        rowFilter: {
          things: (row: any) => row.id !== undefined,
        },
      })

      expect(result.valid).toBe(true)
    })
  })
})

// ============================================================================
// TEST SUITE: STATE ISOLATION
// ============================================================================

describe('State Isolation', () => {
  let mockSql: ReturnType<typeof createMockSqlite>
  let adapter: IcebergCloneAdapter

  beforeEach(() => {
    mockSql = createMockSqlite()
    adapter = new IcebergStateAdapter(mockSql) as unknown as IcebergCloneAdapter
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ---------------------------------------------------------------------------
  // Mutation isolation
  // ---------------------------------------------------------------------------
  describe('mutation isolation after clone', () => {
    it('inserts to original do not appear in clone', async () => {
      mockSql._setTableData('things', [
        { id: 't1', type: 1, name: 'Original', data: {} },
      ])
      const snapshot = await adapter.createSnapshot()

      // This should FAIL - clone() doesn't exist yet
      await adapter.clone('source-do', 'clone-do')

      // Insert new data to original
      mockSql._tables.get('things')!.push(
        { id: 't2', type: 1, name: 'New', data: {} }
      )

      // Verify clone state (would need separate adapter in real impl)
      // Clone should only have t1
      const cloneSnapshot = await adapter.getSnapshot(snapshot.id)
      expect(cloneSnapshot).toBeDefined()
    })

    it('updates to original do not affect clone', async () => {
      mockSql._setTableData('things', [
        { id: 't1', type: 1, name: 'Original', data: { value: 1 } },
      ])
      await adapter.createSnapshot()

      // This should FAIL - clone() doesn't exist yet
      await adapter.clone('source-do', 'clone-do')

      // Update original
      mockSql._setTableData('things', [
        { id: 't1', type: 1, name: 'Updated', data: { value: 2 } },
      ])

      // Clone should still have original value
      // (Verified via snapshot restoration)
    })

    it('deletes from original do not affect clone', async () => {
      mockSql._setTableData('things', createSampleThings(5))
      await adapter.createSnapshot()

      // This should FAIL - clone() doesn't exist yet
      await adapter.clone('source-do', 'clone-do')

      // Delete all from original
      mockSql._setTableData('things', [])

      // Clone should still have all 5 things
    })

    it('inserts to clone do not appear in original', async () => {
      mockSql._setTableData('things', [
        { id: 't1', type: 1, name: 'Original', data: {} },
      ])
      await adapter.createSnapshot()

      // This should FAIL - clone() doesn't exist yet
      await adapter.clone('source-do', 'clone-do')

      // Original should still only have t1
      const originalData = mockSql.exec('SELECT * FROM things').toArray()
      expect(originalData).toHaveLength(1)
    })

    it('updates to clone do not affect original', async () => {
      mockSql._setTableData('things', [
        { id: 't1', type: 1, name: 'Original', data: { value: 1 } },
      ])
      await adapter.createSnapshot()

      // This should FAIL - clone() doesn't exist yet
      await adapter.clone('source-do', 'clone-do')

      // Original should retain original value
      const originalData = mockSql.exec('SELECT * FROM things').toArray()
      expect(originalData).toHaveLength(1)
    })

    it('deletes from clone do not affect original', async () => {
      mockSql._setTableData('things', createSampleThings(5))
      await adapter.createSnapshot()

      // This should FAIL - clone() doesn't exist yet
      await adapter.clone('source-do', 'clone-do')

      // Original should still have 5 things
    })
  })

  // ---------------------------------------------------------------------------
  // Snapshot isolation
  // ---------------------------------------------------------------------------
  describe('snapshot isolation', () => {
    it('clone has independent snapshot history', async () => {
      mockSql._setTableData('things', createSampleThings(3))
      await adapter.createSnapshot() // Snapshot 1

      mockSql._tables.get('things')!.push(
        { id: 'thing-3', type: 1, name: 'New', data: {} }
      )
      await adapter.createSnapshot() // Snapshot 2

      // This should FAIL - clone() doesn't exist yet
      await adapter.clone('source-do', 'clone-do')

      // Clone starts fresh snapshot history
      // Original retains both snapshots
    })

    it('new snapshots on original do not affect clone', async () => {
      mockSql._setTableData('things', createSampleThings(5))
      await adapter.createSnapshot()

      // This should FAIL - clone() doesn't exist yet
      await adapter.clone('source-do', 'clone-do')

      // Create new snapshot on original
      mockSql._tables.get('things')!.push(
        { id: 'new-thing', type: 1, name: 'After Clone', data: {} }
      )
      await adapter.createSnapshot()

      // Clone should not see the new snapshot
    })

    it('new snapshots on clone do not affect original', async () => {
      mockSql._setTableData('things', createSampleThings(5))
      const originalSnapshot = await adapter.createSnapshot()

      // This should FAIL - clone() doesn't exist yet
      await adapter.clone('source-do', 'clone-do')

      // Original's latest snapshot should be unchanged
      expect(originalSnapshot.sequence).toBeDefined()
    })
  })

  // ---------------------------------------------------------------------------
  // Reference isolation
  // ---------------------------------------------------------------------------
  describe('reference isolation', () => {
    it('clone has no reference to original DO runtime', async () => {
      mockSql._setTableData('things', createSampleThings(5))
      await adapter.createSnapshot()

      // This should FAIL - clone() doesn't exist yet
      const result = await adapter.clone('source-do', 'clone-do')

      // Clone should be completely independent
      expect(result.targetId).toBe('clone-do')
    })

    it('clone lineage is optional (no mandatory reference)', async () => {
      mockSql._setTableData('things', createSampleThings(5))
      await adapter.createSnapshot()

      // This should FAIL - clone() doesn't exist yet
      const result = await adapter.clone('source-do', 'clone-do', {
        preserveLineage: false,
      })

      expect(result.lineage).toBeUndefined()
    })

    it('clone lineage can be preserved for auditing', async () => {
      mockSql._setTableData('things', createSampleThings(5))
      await adapter.createSnapshot()

      // This should FAIL - clone() doesn't exist yet
      const result = await adapter.clone('source-do', 'clone-do', {
        preserveLineage: true,
      })

      expect(result.lineage).toBeDefined()
      expect(result.lineage!.sourceDoId).toBe('source-do')
    })
  })

  // ---------------------------------------------------------------------------
  // Copy-on-write isolation
  // ---------------------------------------------------------------------------
  describe('copy-on-write isolation', () => {
    it('shared data files are isolated on first write', async () => {
      mockSql._setTableData('things', createSampleThings(100))
      await adapter.createSnapshot()

      // This should FAIL - clone() doesn't exist yet
      await adapter.clone('source-do', 'clone-do')

      // Both should share data files initially
      // On first write to either, COW triggers physical copy
    })

    it('writes to original trigger COW without affecting clone', async () => {
      mockSql._setTableData('things', createSampleThings(50))
      await adapter.createSnapshot()

      // This should FAIL - clone() doesn't exist yet
      await adapter.clone('source-do', 'clone-do')

      // Write to original
      mockSql._tables.get('things')!.push(
        { id: 'new-thing', type: 1, name: 'COW Trigger', data: {} }
      )

      // Clone should still see original 50 things
    })

    it('writes to clone trigger COW without affecting original', async () => {
      mockSql._setTableData('things', createSampleThings(50))
      await adapter.createSnapshot()

      // This should FAIL - clone() doesn't exist yet
      await adapter.clone('source-do', 'clone-do')

      // Original should still have 50 things
      const originalData = mockSql.exec('SELECT COUNT(*) FROM things').toArray()
      expect(originalData).toHaveLength(1)
    })

    it('both can be written to independently after COW', async () => {
      mockSql._setTableData('things', [{ id: 't1', type: 1, data: { value: 0 } }])
      await adapter.createSnapshot()

      // This should FAIL - clone() doesn't exist yet
      await adapter.clone('source-do', 'clone-do')

      // Write to original: value = 1
      mockSql._setTableData('things', [{ id: 't1', type: 1, data: { value: 1 } }])

      // Write to clone would set value = 2
      // Both should have different values
    })
  })

  // ---------------------------------------------------------------------------
  // Transaction isolation
  // ---------------------------------------------------------------------------
  describe('transaction isolation during clone', () => {
    it('clone is atomic (all or nothing)', async () => {
      mockSql._setTableData('things', createSampleThings(10))
      mockSql._setTableData('relationships', createSampleRelationships(['t-0', 't-1']))
      await adapter.createSnapshot()

      // This should FAIL - clone() doesn't exist yet
      const result = await adapter.clone('source-do', 'clone-do')

      // Either all tables are cloned or none
      expect(result.tablesCloned.length).toBeGreaterThan(0)
    })

    it('failed clone does not leave partial state', async () => {
      mockSql._setTableData('things', createSampleThings(10))

      // Simulate failure mid-clone
      mockSql.exec.mockImplementationOnce(() => {
        throw new Error('Simulated failure')
      })

      // This should FAIL - clone() doesn't exist yet
      await expect(
        adapter.clone('source-do', 'clone-do')
      ).rejects.toThrow()

      // No partial clone state should exist
    })

    it('clone does not see uncommitted changes', async () => {
      mockSql._setTableData('things', createSampleThings(5))
      await adapter.createSnapshot()

      // Simulate uncommitted transaction on source
      // (In real impl, this would be an active transaction)

      // This should FAIL - clone() doesn't exist yet
      await adapter.clone('source-do', 'clone-do')

      // Clone should only see committed state
    })
  })
})
