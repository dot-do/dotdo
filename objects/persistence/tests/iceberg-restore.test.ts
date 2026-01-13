/**
 * IcebergRestore and Time Travel Tests (RED Phase - TDD)
 *
 * Tests for restoring DO state from Iceberg snapshots and time travel queries.
 *
 * RED PHASE: All tests should FAIL initially because the restore() and
 * time travel methods don't exist yet on IcebergStateAdapter.
 *
 * Test Suites:
 *
 * IcebergStateAdapter.restore:
 * 1. Restore state from specific snapshot ID
 * 2. Restore SQL tables to snapshot point
 * 3. Handle missing snapshot gracefully
 * 4. Restore KV storage state
 * 5. Atomic restore with rollback on failure
 *
 * IcebergStateAdapter.timeTravel:
 * 1. List available snapshots
 * 2. Get snapshot by timestamp
 * 3. Get snapshot by sequence number
 * 4. Query data at specific snapshot
 * 5. Handle empty snapshot history
 *
 * @module objects/persistence/tests/iceberg-restore.test
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { IcebergStateAdapter, type IcebergSnapshot } from '../iceberg-state'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Extended IcebergStateAdapter interface with restore and time travel methods
 * These methods don't exist yet - tests should FAIL
 */
interface IcebergStateAdapterWithRestore extends IcebergStateAdapter {
  // Restore methods (to be implemented)
  restore(snapshotId: string): Promise<void>
  restoreToTimestamp(timestampMs: number): Promise<void>
  restoreToSequence(sequence: number): Promise<void>

  // Time travel methods (to be implemented)
  listSnapshots(options?: ListSnapshotsOptions): Promise<SnapshotInfo[]>
  getSnapshotAt(timestampMs: number): Promise<IcebergSnapshot | null>
  getSnapshotBySequence(sequence: number): Promise<IcebergSnapshot | null>
  getSnapshotById(snapshotId: string): Promise<IcebergSnapshot | null>
  queryAtSnapshot<T>(snapshotId: string, query: string): Promise<T[]>
}

interface ListSnapshotsOptions {
  limit?: number
  offset?: number
  startTime?: number
  endTime?: number
}

interface SnapshotInfo {
  id: string
  sequence: number
  timestampMs: number
  schemaVersion: number
  summary?: {
    operation: string
    tableCount: number
    totalRecords: number
  }
}

// ============================================================================
// MOCK HELPERS
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
 * Create a mock snapshot storage for time travel tests
 */
function createMockSnapshotStorage() {
  const snapshots: Map<string, IcebergSnapshot> = new Map()
  const snapshotsBySequence: Map<number, IcebergSnapshot> = new Map()
  const snapshotsByTimestamp: Array<{ timestampMs: number; snapshot: IcebergSnapshot }> = []

  return {
    store: (snapshot: IcebergSnapshot, timestampMs: number) => {
      snapshots.set(snapshot.id, snapshot)
      snapshotsBySequence.set(snapshot.sequence, snapshot)
      snapshotsByTimestamp.push({ timestampMs, snapshot })
      snapshotsByTimestamp.sort((a, b) => b.timestampMs - a.timestampMs) // newest first
    },
    getById: (id: string) => snapshots.get(id) || null,
    getBySequence: (seq: number) => snapshotsBySequence.get(seq) || null,
    getAtTimestamp: (ts: number) => {
      // Find the most recent snapshot before or at the timestamp
      for (const { timestampMs, snapshot } of snapshotsByTimestamp) {
        if (timestampMs <= ts) return snapshot
      }
      return null
    },
    list: (options?: ListSnapshotsOptions) => {
      let result = snapshotsByTimestamp.map((s) => ({
        id: s.snapshot.id,
        sequence: s.snapshot.sequence,
        timestampMs: s.timestampMs,
        schemaVersion: s.snapshot.schemaVersion,
      }))

      if (options?.startTime) {
        result = result.filter((s) => s.timestampMs >= options.startTime!)
      }
      if (options?.endTime) {
        result = result.filter((s) => s.timestampMs <= options.endTime!)
      }
      if (options?.offset) {
        result = result.slice(options.offset)
      }
      if (options?.limit) {
        result = result.slice(0, options.limit)
      }

      return result
    },
    clear: () => {
      snapshots.clear()
      snapshotsBySequence.clear()
      snapshotsByTimestamp.length = 0
    },
    _snapshots: snapshots,
    _byTimestamp: snapshotsByTimestamp,
  }
}

// ============================================================================
// TEST SUITE: IcebergStateAdapter.restore
// ============================================================================

describe('IcebergStateAdapter.restore', () => {
  let mockSql: ReturnType<typeof createMockSqlite>
  let adapter: IcebergStateAdapterWithRestore

  beforeEach(() => {
    mockSql = createMockSqlite()
    // Cast to extended interface - methods don't exist yet (RED phase)
    adapter = new IcebergStateAdapter(mockSql) as unknown as IcebergStateAdapterWithRestore
  })

  // --------------------------------------------------------------------------
  // Test 1: Restore state from specific snapshot ID
  // --------------------------------------------------------------------------
  describe('restore from snapshot ID', () => {
    it('restores state from snapshot', async () => {
      // Setup: Create initial state and snapshot
      mockSql._setTableData('things', [
        { id: 't1', type: 'Customer', data: JSON.stringify({ name: 'Alice' }) },
      ])

      const snapshot = await adapter.createSnapshot()

      // Modify state after snapshot
      mockSql._setTableData('things', [
        { id: 't1', type: 'Customer', data: JSON.stringify({ name: 'Alice Modified' }) },
        { id: 't2', type: 'Order', data: JSON.stringify({ total: 100 }) },
      ])

      // Restore to snapshot
      // This should FAIL - restore() doesn't exist yet
      await adapter.restore(snapshot.id)

      // Verify original state was restored
      const result = mockSql.exec('SELECT * FROM things').toArray()
      expect(result).toHaveLength(1)
      expect((result[0] as { id: string }).id).toBe('t1')
    })

    it('restores multiple tables atomically', async () => {
      // Setup: Create state in multiple tables
      mockSql._setTableData('things', [{ id: 't1', type: 'Entity' }])
      mockSql._setTableData('events', [{ id: 'e1', name: 'Created' }])
      mockSql._setTableData('actions', [{ id: 'a1', verb: 'create' }])

      const snapshot = await adapter.createSnapshot()

      // Modify all tables
      mockSql._setTableData('things', [{ id: 't2', type: 'Modified' }])
      mockSql._setTableData('events', [])
      mockSql._setTableData('actions', [{ id: 'a2', verb: 'update' }, { id: 'a3', verb: 'delete' }])

      // This should FAIL - restore() doesn't exist yet
      await adapter.restore(snapshot.id)

      // All tables should be restored
      expect(mockSql.exec('SELECT * FROM things').toArray()).toHaveLength(1)
      expect(mockSql.exec('SELECT * FROM events').toArray()).toHaveLength(1)
      expect(mockSql.exec('SELECT * FROM actions').toArray()).toHaveLength(1)
    })

    it('clears current state before restore', async () => {
      // Setup: Create snapshot with empty state
      const snapshot = await adapter.createSnapshot()

      // Add data after snapshot
      mockSql._setTableData('things', [
        { id: 't1', type: 'Added' },
        { id: 't2', type: 'Also Added' },
      ])

      // This should FAIL - restore() doesn't exist yet
      await adapter.restore(snapshot.id)

      // Data added after snapshot should be gone
      const result = mockSql.exec('SELECT * FROM things').toArray()
      expect(result).toHaveLength(0)
    })
  })

  // --------------------------------------------------------------------------
  // Test 2: Restore SQL tables to snapshot point
  // --------------------------------------------------------------------------
  describe('restore SQL tables', () => {
    it('restores table structure and data', async () => {
      // Setup: Create table with specific data
      mockSql._setTableData('things', [
        { id: '1', type: 'Product', data: JSON.stringify({ name: 'Widget', price: 9.99 }) },
        { id: '2', type: 'Product', data: JSON.stringify({ name: 'Gadget', price: 19.99 }) },
      ])

      const snapshot = await adapter.createSnapshot()

      // Modify data
      mockSql._setTableData('things', [
        { id: '1', type: 'Product', data: JSON.stringify({ name: 'Widget Updated', price: 14.99 }) },
      ])

      // This should FAIL - restore() doesn't exist yet
      await adapter.restore(snapshot.id)

      // Should have original 2 products with original data
      const result = mockSql.exec('SELECT * FROM things').toArray()
      expect(result).toHaveLength(2)
    })

    it('restores empty table correctly', async () => {
      // Setup: Create snapshot with empty things table
      mockSql._setTableData('things', [])
      const snapshot = await adapter.createSnapshot()

      // Add data
      mockSql._setTableData('things', [{ id: 't1', type: 'New' }])

      // This should FAIL - restore() doesn't exist yet
      await adapter.restore(snapshot.id)

      // Table should be empty again
      const result = mockSql.exec('SELECT * FROM things').toArray()
      expect(result).toHaveLength(0)
    })

    it('preserves column types during restore', async () => {
      // Setup: Create data with various types
      mockSql._setTableData('things', [
        {
          id: 't1',
          type: 'TypeTest',
          data: JSON.stringify({
            stringVal: 'text',
            numberVal: 42,
            boolVal: true,
            nullVal: null,
            arrayVal: [1, 2, 3],
          }),
        },
      ])

      const snapshot = await adapter.createSnapshot()

      // Clear and restore
      mockSql._setTableData('things', [])

      // This should FAIL - restore() doesn't exist yet
      await adapter.restore(snapshot.id)

      const result = mockSql.exec('SELECT * FROM things').toArray() as Array<{ data: string }>
      expect(result).toHaveLength(1)

      const data = JSON.parse(result[0].data)
      expect(data.stringVal).toBe('text')
      expect(data.numberVal).toBe(42)
      expect(data.boolVal).toBe(true)
      expect(data.nullVal).toBeNull()
      expect(data.arrayVal).toEqual([1, 2, 3])
    })
  })

  // --------------------------------------------------------------------------
  // Test 3: Handle missing snapshot gracefully
  // --------------------------------------------------------------------------
  describe('missing snapshot handling', () => {
    it('throws error for non-existent snapshot ID', async () => {
      // This should FAIL - restore() doesn't exist yet
      await expect(adapter.restore('nonexistent-snapshot-id')).rejects.toThrow('Snapshot not found')
    })

    it('throws descriptive error with snapshot ID', async () => {
      const badId = 'invalid-uuid-format-123'

      // This should FAIL - restore() doesn't exist yet
      await expect(adapter.restore(badId)).rejects.toThrow(badId)
    })

    it('handles null/undefined snapshot ID', async () => {
      // This should FAIL - restore() doesn't exist yet
      await expect(adapter.restore(null as unknown as string)).rejects.toThrow()
      await expect(adapter.restore(undefined as unknown as string)).rejects.toThrow()
    })

    it('handles deleted snapshot gracefully', async () => {
      // Create and then "delete" snapshot by corrupting reference
      const snapshot = await adapter.createSnapshot()
      const snapshotId = snapshot.id

      // Simulate snapshot deletion - storage returns null
      // This should FAIL - restore() doesn't exist yet
      await expect(adapter.restore(snapshotId)).rejects.toThrow('Snapshot not found')
    })
  })

  // --------------------------------------------------------------------------
  // Test 4: Restore KV storage state
  // --------------------------------------------------------------------------
  describe('KV storage restore', () => {
    it('restores key-value pairs from snapshot', async () => {
      // Setup: Add KV data to mock
      mockSql._setTableData('things', [
        { id: 'kv:config', type: 'KV', data: JSON.stringify({ key: 'theme', value: 'dark' }) },
        { id: 'kv:settings', type: 'KV', data: JSON.stringify({ key: 'lang', value: 'en' }) },
      ])

      const snapshot = await adapter.createSnapshot()

      // Modify KV data
      mockSql._setTableData('things', [
        { id: 'kv:config', type: 'KV', data: JSON.stringify({ key: 'theme', value: 'light' }) },
      ])

      // This should FAIL - restore() doesn't exist yet
      await adapter.restore(snapshot.id)

      // Original KV pairs should be restored
      const result = mockSql.exec('SELECT * FROM things').toArray()
      expect(result).toHaveLength(2)
    })

    it('restores deleted keys', async () => {
      mockSql._setTableData('things', [
        { id: 'kv:deleted', type: 'KV', data: JSON.stringify({ key: 'deleted', value: 'exists' }) },
      ])

      const snapshot = await adapter.createSnapshot()

      // Delete the key
      mockSql._setTableData('things', [])

      // This should FAIL - restore() doesn't exist yet
      await adapter.restore(snapshot.id)

      // Deleted key should be restored
      const result = mockSql.exec('SELECT * FROM things').toArray()
      expect(result).toHaveLength(1)
    })
  })

  // --------------------------------------------------------------------------
  // Test 5: Atomic restore with rollback on failure
  // --------------------------------------------------------------------------
  describe('atomic restore with rollback', () => {
    it('rolls back on partial failure', async () => {
      const snapshot = await adapter.createSnapshot()

      // Simulate failure during restore by corrupting snapshot data
      snapshot.tables.things = new ArrayBuffer(0)
      snapshot.checksum = 'corrupted'

      // This should FAIL - restore() doesn't exist yet
      await expect(adapter.restore(snapshot.id)).rejects.toThrow()

      // ROLLBACK should have been called
      expect(mockSql.exec).toHaveBeenCalledWith('ROLLBACK')
    })

    it('uses transaction for atomicity', async () => {
      const snapshot = await adapter.createSnapshot()

      // This should FAIL - restore() doesn't exist yet
      await adapter.restore(snapshot.id)

      // Should see transaction commands
      expect(mockSql.exec).toHaveBeenCalledWith('BEGIN TRANSACTION')
      expect(mockSql.exec).toHaveBeenCalledWith('COMMIT')
    })

    it('does not leave partial state on checksum failure', async () => {
      // Setup initial state
      mockSql._setTableData('things', [{ id: 'original', type: 'Original' }])
      const snapshot = await adapter.createSnapshot()

      // Modify state
      mockSql._setTableData('things', [{ id: 'modified', type: 'Modified' }])

      // Corrupt the snapshot checksum
      snapshot.checksum = 'invalid-checksum'

      // This should FAIL - restore() doesn't exist yet
      await expect(adapter.restore(snapshot.id)).rejects.toThrow('Checksum')

      // State should remain as modified (rollback occurred)
      const result = mockSql.exec('SELECT * FROM things').toArray() as Array<{ id: string }>
      expect(result[0].id).toBe('modified')
    })
  })
})

// ============================================================================
// TEST SUITE: IcebergStateAdapter.timeTravel
// ============================================================================

describe('IcebergStateAdapter.timeTravel', () => {
  let mockSql: ReturnType<typeof createMockSqlite>
  let mockStorage: ReturnType<typeof createMockSnapshotStorage>
  let adapter: IcebergStateAdapterWithRestore

  beforeEach(() => {
    mockSql = createMockSqlite()
    mockStorage = createMockSnapshotStorage()
    // Cast to extended interface - methods don't exist yet (RED phase)
    adapter = new IcebergStateAdapter(mockSql) as unknown as IcebergStateAdapterWithRestore
  })

  // --------------------------------------------------------------------------
  // Test 1: List available snapshots
  // --------------------------------------------------------------------------
  describe('listSnapshots', () => {
    it('lists available snapshots', async () => {
      // Create multiple snapshots
      const snap1 = await adapter.createSnapshot()
      mockSql._setTableData('things', [{ id: 't1', type: 'New' }])
      const snap2 = await adapter.createSnapshot()

      // Store in mock storage for time travel
      mockStorage.store(snap1, Date.now() - 1000)
      mockStorage.store(snap2, Date.now())

      // This should FAIL - listSnapshots() doesn't exist yet
      const snapshots = await adapter.listSnapshots()

      expect(snapshots).toHaveLength(2)
      expect(snapshots[0].id).toBe(snap2.id) // Most recent first
      expect(snapshots[1].id).toBe(snap1.id)
    })

    it('returns snapshots in descending order by timestamp', async () => {
      // Create snapshots at different times
      const snap1 = await adapter.createSnapshot()
      const snap2 = await adapter.createSnapshot()
      const snap3 = await adapter.createSnapshot()

      mockStorage.store(snap1, 1000)
      mockStorage.store(snap2, 2000)
      mockStorage.store(snap3, 3000)

      // This should FAIL - listSnapshots() doesn't exist yet
      const snapshots = await adapter.listSnapshots()

      expect(snapshots[0].timestampMs).toBeGreaterThan(snapshots[1].timestampMs)
      expect(snapshots[1].timestampMs).toBeGreaterThan(snapshots[2].timestampMs)
    })

    it('supports limit option', async () => {
      // Create 5 snapshots
      for (let i = 0; i < 5; i++) {
        const snap = await adapter.createSnapshot()
        mockStorage.store(snap, Date.now() + i * 1000)
      }

      // This should FAIL - listSnapshots() doesn't exist yet
      const snapshots = await adapter.listSnapshots({ limit: 3 })

      expect(snapshots).toHaveLength(3)
    })

    it('supports offset option for pagination', async () => {
      // Create 5 snapshots
      const allSnaps: IcebergSnapshot[] = []
      for (let i = 0; i < 5; i++) {
        const snap = await adapter.createSnapshot()
        allSnaps.push(snap)
        mockStorage.store(snap, Date.now() + i * 1000)
      }

      // This should FAIL - listSnapshots() doesn't exist yet
      const page2 = await adapter.listSnapshots({ offset: 2, limit: 2 })

      expect(page2).toHaveLength(2)
      expect(page2[0].sequence).not.toBe(allSnaps[0].sequence)
    })

    it('supports time range filtering', async () => {
      const now = Date.now()
      const snap1 = await adapter.createSnapshot()
      const snap2 = await adapter.createSnapshot()
      const snap3 = await adapter.createSnapshot()

      mockStorage.store(snap1, now - 3600000) // 1 hour ago
      mockStorage.store(snap2, now - 1800000) // 30 min ago
      mockStorage.store(snap3, now) // now

      // This should FAIL - listSnapshots() doesn't exist yet
      const recent = await adapter.listSnapshots({
        startTime: now - 2000000, // ~33 min ago
      })

      expect(recent).toHaveLength(2)
    })

    it('returns empty array for empty history', async () => {
      // No snapshots created
      // This should FAIL - listSnapshots() doesn't exist yet
      const snapshots = await adapter.listSnapshots()

      expect(snapshots).toEqual([])
    })

    it('includes snapshot summary information', async () => {
      mockSql._setTableData('things', [{ id: 't1' }, { id: 't2' }])
      const snapshot = await adapter.createSnapshot()
      mockStorage.store(snapshot, Date.now())

      // This should FAIL - listSnapshots() doesn't exist yet
      const [info] = await adapter.listSnapshots()

      expect(info.summary).toBeDefined()
      expect(info.summary?.tableCount).toBeGreaterThan(0)
    })
  })

  // --------------------------------------------------------------------------
  // Test 2: Get snapshot by timestamp
  // --------------------------------------------------------------------------
  describe('getSnapshotAt', () => {
    it('gets snapshot by timestamp', async () => {
      const before = Date.now()
      const snapshot = await adapter.createSnapshot()
      const after = Date.now()

      mockStorage.store(snapshot, before + 1)

      // This should FAIL - getSnapshotAt() doesn't exist yet
      const result = await adapter.getSnapshotAt(before + 1)

      expect(result).toBeDefined()
      expect(result?.id).toBe(snapshot.id)
    })

    it('returns most recent snapshot before timestamp', async () => {
      const snap1 = await adapter.createSnapshot()
      const snap2 = await adapter.createSnapshot()
      const snap3 = await adapter.createSnapshot()

      mockStorage.store(snap1, 1000)
      mockStorage.store(snap2, 2000)
      mockStorage.store(snap3, 3000)

      // This should FAIL - getSnapshotAt() doesn't exist yet
      const result = await adapter.getSnapshotAt(2500)

      expect(result?.id).toBe(snap2.id) // snap2 is at 2000, before 2500
    })

    it('returns null for timestamp before first snapshot', async () => {
      const snapshot = await adapter.createSnapshot()
      mockStorage.store(snapshot, 1000)

      // This should FAIL - getSnapshotAt() doesn't exist yet
      const result = await adapter.getSnapshotAt(500)

      expect(result).toBeNull()
    })

    it('returns latest snapshot for future timestamp', async () => {
      const snapshot = await adapter.createSnapshot()
      mockStorage.store(snapshot, 1000)

      // This should FAIL - getSnapshotAt() doesn't exist yet
      const result = await adapter.getSnapshotAt(999999)

      expect(result?.id).toBe(snapshot.id)
    })

    it('handles exact timestamp match', async () => {
      const exactTime = 1500
      const snapshot = await adapter.createSnapshot()
      mockStorage.store(snapshot, exactTime)

      // This should FAIL - getSnapshotAt() doesn't exist yet
      const result = await adapter.getSnapshotAt(exactTime)

      expect(result?.id).toBe(snapshot.id)
    })
  })

  // --------------------------------------------------------------------------
  // Test 3: Get snapshot by sequence number
  // --------------------------------------------------------------------------
  describe('getSnapshotBySequence', () => {
    it('gets snapshot by sequence number', async () => {
      const snap1 = await adapter.createSnapshot() // sequence 1
      const snap2 = await adapter.createSnapshot() // sequence 2

      mockStorage.store(snap1, Date.now())
      mockStorage.store(snap2, Date.now())

      // This should FAIL - getSnapshotBySequence() doesn't exist yet
      const result = await adapter.getSnapshotBySequence(1)

      expect(result?.id).toBe(snap1.id)
    })

    it('returns null for non-existent sequence', async () => {
      await adapter.createSnapshot() // sequence 1

      // This should FAIL - getSnapshotBySequence() doesn't exist yet
      const result = await adapter.getSnapshotBySequence(999)

      expect(result).toBeNull()
    })

    it('handles sequence 0', async () => {
      // This should FAIL - getSnapshotBySequence() doesn't exist yet
      const result = await adapter.getSnapshotBySequence(0)

      expect(result).toBeNull() // sequences start at 1
    })

    it('handles negative sequence', async () => {
      // This should FAIL - getSnapshotBySequence() doesn't exist yet
      await expect(adapter.getSnapshotBySequence(-1)).rejects.toThrow()
    })
  })

  // --------------------------------------------------------------------------
  // Test 4: Query data at specific snapshot
  // --------------------------------------------------------------------------
  describe('queryAtSnapshot', () => {
    it('queries data at specific snapshot point', async () => {
      // Setup: Create snapshot with specific data
      mockSql._setTableData('things', [
        { id: 't1', type: 'Product', data: JSON.stringify({ name: 'Widget' }) },
      ])
      const snapshot = await adapter.createSnapshot()

      // Modify data
      mockSql._setTableData('things', [
        { id: 't1', type: 'Product', data: JSON.stringify({ name: 'Widget Modified' }) },
        { id: 't2', type: 'Product', data: JSON.stringify({ name: 'Gadget' }) },
      ])

      // This should FAIL - queryAtSnapshot() doesn't exist yet
      const result = await adapter.queryAtSnapshot<{ id: string }>(
        snapshot.id,
        'SELECT * FROM things'
      )

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('t1')
    })

    it('returns empty array for empty snapshot', async () => {
      mockSql._setTableData('things', [])
      const snapshot = await adapter.createSnapshot()

      // This should FAIL - queryAtSnapshot() doesn't exist yet
      const result = await adapter.queryAtSnapshot(snapshot.id, 'SELECT * FROM things')

      expect(result).toEqual([])
    })

    it('supports WHERE clauses', async () => {
      mockSql._setTableData('things', [
        { id: 't1', type: 'Product' },
        { id: 't2', type: 'Service' },
      ])
      const snapshot = await adapter.createSnapshot()

      // This should FAIL - queryAtSnapshot() doesn't exist yet
      const result = await adapter.queryAtSnapshot<{ id: string; type: string }>(
        snapshot.id,
        "SELECT * FROM things WHERE type = 'Product'"
      )

      expect(result).toHaveLength(1)
      expect(result[0].type).toBe('Product')
    })

    it('throws for invalid snapshot ID', async () => {
      // This should FAIL - queryAtSnapshot() doesn't exist yet
      await expect(
        adapter.queryAtSnapshot('invalid-id', 'SELECT * FROM things')
      ).rejects.toThrow('Snapshot not found')
    })

    it('does not modify current state during query', async () => {
      mockSql._setTableData('things', [{ id: 't1', type: 'Original' }])
      const snapshot = await adapter.createSnapshot()

      mockSql._setTableData('things', [{ id: 't2', type: 'Current' }])

      // Query at old snapshot
      // This should FAIL - queryAtSnapshot() doesn't exist yet
      await adapter.queryAtSnapshot(snapshot.id, 'SELECT * FROM things')

      // Current state should be unchanged
      const current = mockSql.exec('SELECT * FROM things').toArray() as Array<{ id: string }>
      expect(current[0].id).toBe('t2')
    })
  })

  // --------------------------------------------------------------------------
  // Test 5: Handle empty snapshot history
  // --------------------------------------------------------------------------
  describe('empty snapshot history', () => {
    it('listSnapshots returns empty array', async () => {
      // This should FAIL - listSnapshots() doesn't exist yet
      const snapshots = await adapter.listSnapshots()
      expect(snapshots).toEqual([])
    })

    it('getSnapshotAt returns null', async () => {
      // This should FAIL - getSnapshotAt() doesn't exist yet
      const snapshot = await adapter.getSnapshotAt(Date.now())
      expect(snapshot).toBeNull()
    })

    it('getSnapshotBySequence returns null', async () => {
      // This should FAIL - getSnapshotBySequence() doesn't exist yet
      const snapshot = await adapter.getSnapshotBySequence(1)
      expect(snapshot).toBeNull()
    })

    it('restore throws meaningful error', async () => {
      // This should FAIL - restore() doesn't exist yet
      await expect(adapter.restore('any-id')).rejects.toThrow('Snapshot not found')
    })
  })
})

// ============================================================================
// TEST SUITE: IcebergStateAdapter.restoreToTimestamp
// ============================================================================

describe('IcebergStateAdapter.restoreToTimestamp', () => {
  let mockSql: ReturnType<typeof createMockSqlite>
  let adapter: IcebergStateAdapterWithRestore

  beforeEach(() => {
    mockSql = createMockSqlite()
    adapter = new IcebergStateAdapter(mockSql) as unknown as IcebergStateAdapterWithRestore
  })

  it('restores to state at specific timestamp', async () => {
    const t1 = Date.now()
    mockSql._setTableData('things', [{ id: 'v1' }])
    await adapter.createSnapshot()

    const t2 = Date.now() + 1000
    mockSql._setTableData('things', [{ id: 'v2' }])
    await adapter.createSnapshot()

    // This should FAIL - restoreToTimestamp() doesn't exist yet
    await adapter.restoreToTimestamp(t1 + 500)

    const result = mockSql.exec('SELECT * FROM things').toArray() as Array<{ id: string }>
    expect(result[0].id).toBe('v1')
  })

  it('throws for timestamp before any snapshot', async () => {
    await adapter.createSnapshot()

    // This should FAIL - restoreToTimestamp() doesn't exist yet
    await expect(adapter.restoreToTimestamp(1)).rejects.toThrow('No snapshot found')
  })
})

// ============================================================================
// TEST SUITE: IcebergStateAdapter.restoreToSequence
// ============================================================================

describe('IcebergStateAdapter.restoreToSequence', () => {
  let mockSql: ReturnType<typeof createMockSqlite>
  let adapter: IcebergStateAdapterWithRestore

  beforeEach(() => {
    mockSql = createMockSqlite()
    adapter = new IcebergStateAdapter(mockSql) as unknown as IcebergStateAdapterWithRestore
  })

  it('restores to state at specific sequence number', async () => {
    mockSql._setTableData('things', [{ id: 'seq1' }])
    await adapter.createSnapshot() // seq 1

    mockSql._setTableData('things', [{ id: 'seq2' }])
    await adapter.createSnapshot() // seq 2

    mockSql._setTableData('things', [{ id: 'seq3' }])
    await adapter.createSnapshot() // seq 3

    // This should FAIL - restoreToSequence() doesn't exist yet
    await adapter.restoreToSequence(2)

    const result = mockSql.exec('SELECT * FROM things').toArray() as Array<{ id: string }>
    expect(result[0].id).toBe('seq2')
  })

  it('throws for non-existent sequence', async () => {
    await adapter.createSnapshot()

    // This should FAIL - restoreToSequence() doesn't exist yet
    await expect(adapter.restoreToSequence(999)).rejects.toThrow('Sequence not found')
  })

  it('throws for sequence 0', async () => {
    // This should FAIL - restoreToSequence() doesn't exist yet
    await expect(adapter.restoreToSequence(0)).rejects.toThrow()
  })
})

// ============================================================================
// TEST SUITE: Error Handling
// ============================================================================

describe('IcebergStateAdapter error handling', () => {
  let mockSql: ReturnType<typeof createMockSqlite>
  let adapter: IcebergStateAdapterWithRestore

  beforeEach(() => {
    mockSql = createMockSqlite()
    adapter = new IcebergStateAdapter(mockSql) as unknown as IcebergStateAdapterWithRestore
  })

  it('handles corrupted snapshot data', async () => {
    const snapshot = await adapter.createSnapshot()
    snapshot.tables = {} // Corrupt tables

    // This should FAIL - restore() doesn't exist yet
    await expect(adapter.restore(snapshot.id)).rejects.toThrow()
  })

  it('handles missing table in snapshot', async () => {
    const snapshot = await adapter.createSnapshot()
    delete snapshot.tables.things

    // This should FAIL - restore() doesn't exist yet
    await expect(adapter.restore(snapshot.id)).rejects.toThrow()
  })

  it('handles SQL execution errors during restore', async () => {
    const snapshot = await adapter.createSnapshot()

    // Make SQL exec fail
    mockSql.exec.mockImplementationOnce(() => {
      throw new Error('SQL error')
    })

    // This should FAIL - restore() doesn't exist yet
    await expect(adapter.restore(snapshot.id)).rejects.toThrow('SQL error')
  })

  it('logs warning for schema version mismatch but allows restore with flag', async () => {
    const adapter1 = new IcebergStateAdapter(mockSql, {
      schemaVersion: 1,
    }) as unknown as IcebergStateAdapterWithRestore

    const snapshot = await adapter1.createSnapshot()

    const adapter2 = new IcebergStateAdapter(mockSql, {
      schemaVersion: 2,
    }) as unknown as IcebergStateAdapterWithRestore

    // This should FAIL - restore() doesn't exist yet
    // Default behavior should throw
    await expect(adapter2.restore(snapshot.id)).rejects.toThrow('Schema version mismatch')
  })
})
