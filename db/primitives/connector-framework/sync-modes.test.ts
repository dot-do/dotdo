/**
 * Sync Modes Tests - TDD for connector sync strategies
 *
 * Tests for:
 * - Full refresh sync mode (dotdo-alj17)
 * - Incremental sync with cursors (dotdo-w99yl)
 * - CDC sync mode (dotdo-c8tm4)
 *
 * @module db/primitives/connector-framework/sync-modes
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  // Sync mode implementations
  FullRefreshSync,
  IncrementalSync,
  CDCSyncMode,
  createFullRefreshSync,
  createIncrementalSync,
  createCDCSync,
  // Types
  type SyncModeConfig,
  type FullRefreshConfig,
  type IncrementalConfig,
  type CDCConfig,
  type SyncProgress,
  type SyncCheckpoint,
  type CDCRecordType,
} from './sync-modes'
import {
  type AirbyteMessage,
  type RecordMessage,
  type StateMessage,
  type ConfiguredCatalog,
  type SyncState,
} from './index'

// =============================================================================
// Full Refresh Sync Mode Tests (dotdo-alj17)
// =============================================================================

describe('FullRefreshSync', () => {
  describe('read(config, catalog)', () => {
    it('should emit all records from source', async () => {
      const mockData = [
        { id: 1, name: 'Alice', email: 'alice@example.com' },
        { id: 2, name: 'Bob', email: 'bob@example.com' },
        { id: 3, name: 'Charlie', email: 'charlie@example.com' },
      ]

      const sync = createFullRefreshSync({
        fetchRecords: async () => mockData,
        streamName: 'users',
      })

      const messages: AirbyteMessage[] = []
      for await (const msg of sync.read({}, { streams: [{ name: 'users', syncMode: 'full_refresh' }] })) {
        messages.push(msg)
      }

      const records = messages.filter((m): m is RecordMessage => m.type === 'RECORD')
      expect(records).toHaveLength(3)
      expect(records[0].record.data).toEqual({ id: 1, name: 'Alice', email: 'alice@example.com' })
    })

    it('should emit log messages for progress tracking', async () => {
      const mockData = Array.from({ length: 100 }, (_, i) => ({ id: i + 1 }))

      const sync = createFullRefreshSync({
        fetchRecords: async () => mockData,
        streamName: 'items',
        logProgress: true,
        logInterval: 25,
      })

      const messages: AirbyteMessage[] = []
      for await (const msg of sync.read({}, { streams: [{ name: 'items', syncMode: 'full_refresh' }] })) {
        messages.push(msg)
      }

      const logs = messages.filter((m) => m.type === 'LOG')
      expect(logs.length).toBeGreaterThan(0)
    })
  })

  describe('destination modes', () => {
    it('should support overwrite mode - replaces all existing data', async () => {
      const sync = createFullRefreshSync({
        fetchRecords: async () => [{ id: 1 }, { id: 2 }],
        streamName: 'users',
        destinationSyncMode: 'overwrite',
      })

      const config = sync.getConfig()
      expect(config.destinationSyncMode).toBe('overwrite')
    })

    it('should support append mode - adds to existing data', async () => {
      const sync = createFullRefreshSync({
        fetchRecords: async () => [{ id: 1 }, { id: 2 }],
        streamName: 'users',
        destinationSyncMode: 'append',
      })

      const config = sync.getConfig()
      expect(config.destinationSyncMode).toBe('append')
    })
  })

  describe('batch vs streaming emission', () => {
    it('should emit records in batches when batchSize is set', async () => {
      const mockData = Array.from({ length: 10 }, (_, i) => ({ id: i + 1 }))
      const batchesEmitted: number[] = []

      const sync = createFullRefreshSync({
        fetchRecords: async () => mockData,
        streamName: 'items',
        batchSize: 3,
        onBatchEmit: (count) => batchesEmitted.push(count),
      })

      const messages: AirbyteMessage[] = []
      for await (const msg of sync.read({}, { streams: [{ name: 'items', syncMode: 'full_refresh' }] })) {
        messages.push(msg)
      }

      expect(batchesEmitted).toEqual([3, 3, 3, 1]) // 10 records in batches of 3
    })

    it('should stream records one by one when batchSize is not set', async () => {
      const mockData = [{ id: 1 }, { id: 2 }, { id: 3 }]

      const sync = createFullRefreshSync({
        fetchRecords: async () => mockData,
        streamName: 'items',
      })

      const messages: AirbyteMessage[] = []
      for await (const msg of sync.read({}, { streams: [{ name: 'items', syncMode: 'full_refresh' }] })) {
        messages.push(msg)
      }

      const records = messages.filter((m): m is RecordMessage => m.type === 'RECORD')
      expect(records).toHaveLength(3)
    })
  })

  describe('progress tracking', () => {
    it('should track sync progress', async () => {
      const mockData = Array.from({ length: 50 }, (_, i) => ({ id: i + 1 }))

      const sync = createFullRefreshSync({
        fetchRecords: async () => mockData,
        streamName: 'items',
      })

      for await (const _ of sync.read({}, { streams: [{ name: 'items', syncMode: 'full_refresh' }] })) {
        // consume all
      }

      const progress = sync.getProgress()
      expect(progress.recordsEmitted).toBe(50)
      expect(progress.bytesEmitted).toBeGreaterThan(0)
      expect(progress.status).toBe('completed')
    })

    it('should report error status on failure', async () => {
      const sync = createFullRefreshSync({
        fetchRecords: async () => {
          throw new Error('Connection failed')
        },
        streamName: 'items',
      })

      try {
        for await (const _ of sync.read({}, { streams: [{ name: 'items', syncMode: 'full_refresh' }] })) {
          // consume
        }
      } catch {
        // expected
      }

      const progress = sync.getProgress()
      expect(progress.status).toBe('failed')
      expect(progress.error).toMatch(/Connection failed/)
    })
  })

  describe('pagination support', () => {
    it('should handle paginated data sources', async () => {
      let page = 0
      const pages = [
        [{ id: 1 }, { id: 2 }],
        [{ id: 3 }, { id: 4 }],
        [],
      ]

      const sync = createFullRefreshSync({
        fetchRecords: async (cursor) => {
          const currentPage = pages[page] || []
          page++
          return currentPage
        },
        streamName: 'items',
        paginate: true,
      })

      const messages: AirbyteMessage[] = []
      for await (const msg of sync.read({}, { streams: [{ name: 'items', syncMode: 'full_refresh' }] })) {
        messages.push(msg)
      }

      const records = messages.filter((m): m is RecordMessage => m.type === 'RECORD')
      expect(records).toHaveLength(4)
    })
  })
})

// =============================================================================
// Incremental Sync Mode Tests (dotdo-w99yl)
// =============================================================================

describe('IncrementalSync', () => {
  describe('cursor field selection', () => {
    it('should use specified cursor field', async () => {
      const mockData = [
        { id: 1, updated_at: '2024-01-03T00:00:00Z' },
        { id: 2, updated_at: '2024-01-04T00:00:00Z' },
      ]

      const sync = createIncrementalSync({
        fetchRecords: async (cursor) => mockData.filter((r) => !cursor || r.updated_at > cursor),
        streamName: 'items',
        cursorField: 'updated_at',
      })

      const messages: AirbyteMessage[] = []
      for await (const msg of sync.read({}, { streams: [{ name: 'items', syncMode: 'incremental', cursorField: ['updated_at'] }] })) {
        messages.push(msg)
      }

      const records = messages.filter((m): m is RecordMessage => m.type === 'RECORD')
      expect(records).toHaveLength(2)
    })

    it('should support composite cursor fields (e.g., updated_at + id)', async () => {
      const sync = createIncrementalSync({
        fetchRecords: async () => [],
        streamName: 'items',
        cursorField: ['updated_at', 'id'],
      })

      const config = sync.getConfig()
      expect(config.cursorField).toEqual(['updated_at', 'id'])
    })
  })

  describe('state checkpoint emission', () => {
    it('should emit state checkpoints with cursor value', async () => {
      const mockData = [
        { id: 1, updated_at: '2024-01-01T00:00:00Z' },
        { id: 2, updated_at: '2024-01-02T00:00:00Z' },
        { id: 3, updated_at: '2024-01-03T00:00:00Z' },
      ]

      const sync = createIncrementalSync({
        fetchRecords: async () => mockData,
        streamName: 'items',
        cursorField: 'updated_at',
        checkpointInterval: 2,
      })

      const messages: AirbyteMessage[] = []
      for await (const msg of sync.read({}, { streams: [{ name: 'items', syncMode: 'incremental' }] })) {
        messages.push(msg)
      }

      const states = messages.filter((m): m is StateMessage => m.type === 'STATE')
      expect(states.length).toBeGreaterThan(0)
      expect(states[states.length - 1].state.stream?.streamState.cursor).toBe('2024-01-03T00:00:00Z')
    })

    it('should emit state after each batch', async () => {
      const mockData = Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        updated_at: `2024-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
      }))

      const sync = createIncrementalSync({
        fetchRecords: async () => mockData,
        streamName: 'items',
        cursorField: 'updated_at',
        checkpointInterval: 3,
      })

      const messages: AirbyteMessage[] = []
      for await (const msg of sync.read({}, { streams: [{ name: 'items', syncMode: 'incremental' }] })) {
        messages.push(msg)
      }

      const states = messages.filter((m): m is StateMessage => m.type === 'STATE')
      expect(states.length).toBeGreaterThanOrEqual(3) // At least 3 checkpoints for 10 records at interval 3
    })
  })

  describe('resume from last cursor value', () => {
    it('should resume from provided state', async () => {
      const allRecords = [
        { id: 1, updated_at: '2024-01-01T00:00:00Z' },
        { id: 2, updated_at: '2024-01-02T00:00:00Z' },
        { id: 3, updated_at: '2024-01-03T00:00:00Z' },
        { id: 4, updated_at: '2024-01-04T00:00:00Z' },
      ]

      const sync = createIncrementalSync({
        fetchRecords: async (cursor) => {
          if (!cursor) return allRecords
          return allRecords.filter((r) => r.updated_at > cursor)
        },
        streamName: 'items',
        cursorField: 'updated_at',
      })

      const state: SyncState = {
        streams: {
          items: { cursor: '2024-01-02T00:00:00Z' },
        },
      }

      const messages: AirbyteMessage[] = []
      for await (const msg of sync.read({}, { streams: [{ name: 'items', syncMode: 'incremental' }] }, state)) {
        messages.push(msg)
      }

      const records = messages.filter((m): m is RecordMessage => m.type === 'RECORD')
      expect(records).toHaveLength(2) // Only records after cursor
      expect(records[0].record.data.id).toBe(3)
    })

    it('should handle missing state gracefully (full sync)', async () => {
      const mockData = [{ id: 1 }, { id: 2 }]

      const sync = createIncrementalSync({
        fetchRecords: async () => mockData,
        streamName: 'items',
        cursorField: 'updated_at',
      })

      const messages: AirbyteMessage[] = []
      for await (const msg of sync.read({}, { streams: [{ name: 'items', syncMode: 'incremental' }] })) {
        messages.push(msg)
      }

      const records = messages.filter((m): m is RecordMessage => m.type === 'RECORD')
      expect(records).toHaveLength(2)
    })
  })

  describe('deduplication strategies', () => {
    it('should support append_dedup mode with primary key', async () => {
      const sync = createIncrementalSync({
        fetchRecords: async () => [
          { id: 1, name: 'Alice v1', updated_at: '2024-01-01' },
          { id: 1, name: 'Alice v2', updated_at: '2024-01-02' },
        ],
        streamName: 'users',
        cursorField: 'updated_at',
        primaryKey: [['id']],
        destinationSyncMode: 'append_dedup',
      })

      const config = sync.getConfig()
      expect(config.destinationSyncMode).toBe('append_dedup')
      expect(config.primaryKey).toEqual([['id']])
    })

    it('should track seen primary keys for deduplication', async () => {
      const mockData = [
        { id: 1, name: 'Alice', updated_at: '2024-01-01' },
        { id: 2, name: 'Bob', updated_at: '2024-01-02' },
        { id: 1, name: 'Alice Updated', updated_at: '2024-01-03' }, // Duplicate id
      ]

      const sync = createIncrementalSync({
        fetchRecords: async () => mockData,
        streamName: 'users',
        cursorField: 'updated_at',
        primaryKey: [['id']],
        deduplicateInSource: true,
      })

      const messages: AirbyteMessage[] = []
      for await (const msg of sync.read({}, { streams: [{ name: 'users', syncMode: 'incremental' }] })) {
        messages.push(msg)
      }

      const records = messages.filter((m): m is RecordMessage => m.type === 'RECORD')
      // Should only emit latest version of each id
      expect(records).toHaveLength(2)
    })
  })

  describe('cursor value extraction', () => {
    it('should extract cursor value from nested field', async () => {
      const mockData = [
        { id: 1, metadata: { updated_at: '2024-01-01' } },
        { id: 2, metadata: { updated_at: '2024-01-02' } },
      ]

      const sync = createIncrementalSync({
        fetchRecords: async () => mockData,
        streamName: 'items',
        cursorField: ['metadata', 'updated_at'],
      })

      const messages: AirbyteMessage[] = []
      for await (const msg of sync.read({}, { streams: [{ name: 'items', syncMode: 'incremental' }] })) {
        messages.push(msg)
      }

      const states = messages.filter((m): m is StateMessage => m.type === 'STATE')
      expect(states[states.length - 1].state.stream?.streamState.cursor).toBe('2024-01-02')
    })
  })
})

// =============================================================================
// CDC Sync Mode Tests (dotdo-c8tm4)
// =============================================================================

describe('CDCSyncMode', () => {
  describe('CDC record types', () => {
    it('should emit INSERT records', async () => {
      const changes = [
        { type: 'insert' as const, record: { id: 1, name: 'Alice' }, lsn: '0/1234' },
      ]

      const sync = createCDCSync({
        fetchChanges: async () => changes,
        streamName: 'users',
      })

      const messages: AirbyteMessage[] = []
      for await (const msg of sync.read({}, { streams: [{ name: 'users', syncMode: 'incremental' }] })) {
        messages.push(msg)
      }

      const records = messages.filter((m): m is RecordMessage => m.type === 'RECORD')
      expect(records).toHaveLength(1)
      expect(records[0].record.data._cdc_op).toBe('insert')
    })

    it('should emit UPDATE records with before and after', async () => {
      const changes = [
        {
          type: 'update' as const,
          before: { id: 1, name: 'Alice' },
          after: { id: 1, name: 'Alice Smith' },
          lsn: '0/1235',
        },
      ]

      const sync = createCDCSync({
        fetchChanges: async () => changes,
        streamName: 'users',
      })

      const messages: AirbyteMessage[] = []
      for await (const msg of sync.read({}, { streams: [{ name: 'users', syncMode: 'incremental' }] })) {
        messages.push(msg)
      }

      const records = messages.filter((m): m is RecordMessage => m.type === 'RECORD')
      expect(records).toHaveLength(1)
      expect(records[0].record.data._cdc_op).toBe('update')
      expect(records[0].record.data._cdc_before).toEqual({ id: 1, name: 'Alice' })
    })

    it('should emit DELETE records', async () => {
      const changes = [
        { type: 'delete' as const, record: { id: 1, name: 'Alice' }, lsn: '0/1236' },
      ]

      const sync = createCDCSync({
        fetchChanges: async () => changes,
        streamName: 'users',
      })

      const messages: AirbyteMessage[] = []
      for await (const msg of sync.read({}, { streams: [{ name: 'users', syncMode: 'incremental' }] })) {
        messages.push(msg)
      }

      const records = messages.filter((m): m is RecordMessage => m.type === 'RECORD')
      expect(records).toHaveLength(1)
      expect(records[0].record.data._cdc_op).toBe('delete')
      expect(records[0].record.data._cdc_deleted_at).toBeDefined()
    })
  })

  describe('LSN/offset tracking', () => {
    it('should track LSN for PostgreSQL-style sources', async () => {
      const changes = [
        { type: 'insert' as const, record: { id: 1 }, lsn: '0/1234' },
        { type: 'insert' as const, record: { id: 2 }, lsn: '0/1235' },
        { type: 'insert' as const, record: { id: 3 }, lsn: '0/1236' },
      ]

      const sync = createCDCSync({
        fetchChanges: async () => changes,
        streamName: 'users',
      })

      const messages: AirbyteMessage[] = []
      for await (const msg of sync.read({}, { streams: [{ name: 'users', syncMode: 'incremental' }] })) {
        messages.push(msg)
      }

      const states = messages.filter((m): m is StateMessage => m.type === 'STATE')
      expect(states[states.length - 1].state.stream?.streamState.lsn).toBe('0/1236')
    })

    it('should track offset for Kafka-style sources', async () => {
      const changes = [
        { type: 'insert' as const, record: { id: 1 }, offset: 100 },
        { type: 'insert' as const, record: { id: 2 }, offset: 101 },
      ]

      const sync = createCDCSync({
        fetchChanges: async () => changes,
        streamName: 'users',
        offsetField: 'offset',
      })

      const messages: AirbyteMessage[] = []
      for await (const msg of sync.read({}, { streams: [{ name: 'users', syncMode: 'incremental' }] })) {
        messages.push(msg)
      }

      const states = messages.filter((m): m is StateMessage => m.type === 'STATE')
      expect(states[states.length - 1].state.stream?.streamState.offset).toBe(101)
    })

    it('should resume from last LSN', async () => {
      const allChanges = [
        { type: 'insert' as const, record: { id: 1 }, lsn: '0/1234' },
        { type: 'insert' as const, record: { id: 2 }, lsn: '0/1235' },
        { type: 'insert' as const, record: { id: 3 }, lsn: '0/1236' },
      ]

      const sync = createCDCSync({
        fetchChanges: async (lsn) => {
          if (!lsn) return allChanges
          return allChanges.filter((c) => c.lsn > lsn)
        },
        streamName: 'users',
      })

      const state: SyncState = {
        streams: {
          users: { lsn: '0/1234' },
        },
      }

      const messages: AirbyteMessage[] = []
      for await (const msg of sync.read({}, { streams: [{ name: 'users', syncMode: 'incremental' }] }, state)) {
        messages.push(msg)
      }

      const records = messages.filter((m): m is RecordMessage => m.type === 'RECORD')
      expect(records).toHaveLength(2)
      expect(records[0].record.data.id).toBe(2)
    })
  })

  describe('soft delete handling', () => {
    it('should mark deleted records with soft delete timestamp', async () => {
      const changes = [
        { type: 'delete' as const, record: { id: 1, name: 'Alice' }, lsn: '0/1234' },
      ]

      const sync = createCDCSync({
        fetchChanges: async () => changes,
        streamName: 'users',
        softDelete: true,
      })

      const messages: AirbyteMessage[] = []
      for await (const msg of sync.read({}, { streams: [{ name: 'users', syncMode: 'incremental' }] })) {
        messages.push(msg)
      }

      const records = messages.filter((m): m is RecordMessage => m.type === 'RECORD')
      expect(records[0].record.data._cdc_deleted_at).toBeDefined()
      expect(records[0].record.data.id).toBe(1) // Original data preserved
    })

    it('should emit hard deletes when softDelete is false', async () => {
      const changes = [
        { type: 'delete' as const, record: { id: 1 }, lsn: '0/1234' },
      ]

      const sync = createCDCSync({
        fetchChanges: async () => changes,
        streamName: 'users',
        softDelete: false,
      })

      const messages: AirbyteMessage[] = []
      for await (const msg of sync.read({}, { streams: [{ name: 'users', syncMode: 'incremental' }] })) {
        messages.push(msg)
      }

      const records = messages.filter((m): m is RecordMessage => m.type === 'RECORD')
      expect(records[0].record.data._cdc_is_hard_delete).toBe(true)
    })
  })

  describe('initial snapshot + streaming pattern', () => {
    it('should perform initial snapshot when no state exists', async () => {
      const snapshotData = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ]

      const sync = createCDCSync({
        fetchChanges: async () => [],
        streamName: 'users',
        initialSnapshot: {
          enabled: true,
          fetchSnapshot: async () => snapshotData,
        },
      })

      const messages: AirbyteMessage[] = []
      for await (const msg of sync.read({}, { streams: [{ name: 'users', syncMode: 'incremental' }] })) {
        messages.push(msg)
      }

      const records = messages.filter((m): m is RecordMessage => m.type === 'RECORD')
      expect(records).toHaveLength(2)
      expect(records[0].record.data._cdc_snapshot).toBe(true)
    })

    it('should skip snapshot when state exists (resume CDC)', async () => {
      const snapshotData = [{ id: 1 }, { id: 2 }]
      const changes = [
        { type: 'insert' as const, record: { id: 3 }, lsn: '0/1237' },
      ]

      let snapshotCalled = false
      const sync = createCDCSync({
        fetchChanges: async () => changes,
        streamName: 'users',
        initialSnapshot: {
          enabled: true,
          fetchSnapshot: async () => {
            snapshotCalled = true
            return snapshotData
          },
        },
      })

      const state: SyncState = {
        streams: {
          users: { lsn: '0/1236', snapshotComplete: true },
        },
      }

      const messages: AirbyteMessage[] = []
      for await (const msg of sync.read({}, { streams: [{ name: 'users', syncMode: 'incremental' }] }, state)) {
        messages.push(msg)
      }

      expect(snapshotCalled).toBe(false)
      const records = messages.filter((m): m is RecordMessage => m.type === 'RECORD')
      expect(records).toHaveLength(1)
      expect(records[0].record.data.id).toBe(3)
    })

    it('should mark snapshot completion in state', async () => {
      const snapshotData = [{ id: 1 }]

      const sync = createCDCSync({
        fetchChanges: async () => [],
        streamName: 'users',
        initialSnapshot: {
          enabled: true,
          fetchSnapshot: async () => snapshotData,
        },
      })

      const messages: AirbyteMessage[] = []
      for await (const msg of sync.read({}, { streams: [{ name: 'users', syncMode: 'incremental' }] })) {
        messages.push(msg)
      }

      const states = messages.filter((m): m is StateMessage => m.type === 'STATE')
      expect(states[states.length - 1].state.stream?.streamState.snapshotComplete).toBe(true)
    })

    it('should transition from snapshot to streaming', async () => {
      const snapshotData = [{ id: 1 }, { id: 2 }]
      const cdcChanges = [
        { type: 'insert' as const, record: { id: 3 }, lsn: '0/1237' },
      ]

      const sync = createCDCSync({
        fetchChanges: async () => cdcChanges,
        streamName: 'users',
        initialSnapshot: {
          enabled: true,
          fetchSnapshot: async () => snapshotData,
          startLsn: '0/1236',
        },
      })

      const messages: AirbyteMessage[] = []
      for await (const msg of sync.read({}, { streams: [{ name: 'users', syncMode: 'incremental' }] })) {
        messages.push(msg)
      }

      const records = messages.filter((m): m is RecordMessage => m.type === 'RECORD')
      expect(records).toHaveLength(3)

      // First two should be snapshot records
      expect(records[0].record.data._cdc_snapshot).toBe(true)
      expect(records[1].record.data._cdc_snapshot).toBe(true)

      // Third should be CDC record
      expect(records[2].record.data._cdc_snapshot).toBeUndefined()
    })
  })

  describe('ordering guarantees', () => {
    it('should preserve LSN order', async () => {
      const changes = [
        { type: 'insert' as const, record: { id: 3 }, lsn: '0/1236' },
        { type: 'insert' as const, record: { id: 1 }, lsn: '0/1234' },
        { type: 'insert' as const, record: { id: 2 }, lsn: '0/1235' },
      ]

      const sync = createCDCSync({
        fetchChanges: async () => changes,
        streamName: 'users',
        sortByLsn: true,
      })

      const messages: AirbyteMessage[] = []
      for await (const msg of sync.read({}, { streams: [{ name: 'users', syncMode: 'incremental' }] })) {
        messages.push(msg)
      }

      const records = messages.filter((m): m is RecordMessage => m.type === 'RECORD')
      expect(records[0].record.data.id).toBe(1)
      expect(records[1].record.data.id).toBe(2)
      expect(records[2].record.data.id).toBe(3)
    })
  })

  describe('error handling', () => {
    it('should handle transient errors with retry', async () => {
      let attempts = 0
      const sync = createCDCSync({
        fetchChanges: async () => {
          attempts++
          if (attempts < 3) {
            throw new Error('Temporary failure')
          }
          return [{ type: 'insert' as const, record: { id: 1 }, lsn: '0/1234' }]
        },
        streamName: 'users',
        retryConfig: {
          maxRetries: 3,
          retryDelayMs: 10,
        },
      })

      const messages: AirbyteMessage[] = []
      for await (const msg of sync.read({}, { streams: [{ name: 'users', syncMode: 'incremental' }] })) {
        messages.push(msg)
      }

      expect(attempts).toBe(3)
      const records = messages.filter((m): m is RecordMessage => m.type === 'RECORD')
      expect(records).toHaveLength(1)
    })

    it('should emit error log and fail after max retries', async () => {
      const sync = createCDCSync({
        fetchChanges: async () => {
          throw new Error('Persistent failure')
        },
        streamName: 'users',
        retryConfig: {
          maxRetries: 2,
          retryDelayMs: 10,
        },
      })

      const messages: AirbyteMessage[] = []
      try {
        for await (const msg of sync.read({}, { streams: [{ name: 'users', syncMode: 'incremental' }] })) {
          messages.push(msg)
        }
      } catch (err) {
        expect((err as Error).message).toMatch(/Persistent failure/)
      }

      const logs = messages.filter((m) => m.type === 'LOG')
      expect(logs.some((l) => l.type === 'LOG' && (l as any).log.level === 'ERROR')).toBe(true)
    })
  })
})

// =============================================================================
// Additional CDC Edge Cases (dotdo-c8tm4)
// =============================================================================

describe('CDCSyncMode - Edge Cases', () => {
  describe('timestamp handling', () => {
    it('should include _cdc_timestamp in all record types', async () => {
      const now = Date.now()
      const changes = [
        { type: 'insert' as const, record: { id: 1 }, lsn: '0/1234', timestamp: now },
        { type: 'update' as const, before: { id: 2, name: 'old' }, after: { id: 2, name: 'new' }, lsn: '0/1235', timestamp: now + 1 },
        { type: 'delete' as const, record: { id: 3 }, lsn: '0/1236', timestamp: now + 2 },
      ]

      const sync = createCDCSync({
        fetchChanges: async () => changes,
        streamName: 'users',
      })

      const messages: AirbyteMessage[] = []
      for await (const msg of sync.read({}, { streams: [{ name: 'users', syncMode: 'incremental' }] })) {
        messages.push(msg)
      }

      const records = messages.filter((m): m is RecordMessage => m.type === 'RECORD')
      expect(records).toHaveLength(3)
      expect(records[0].record.data._cdc_timestamp).toBe(now)
      expect(records[1].record.data._cdc_timestamp).toBe(now + 1)
      expect(records[2].record.data._cdc_timestamp).toBe(now + 2)
    })

    it('should use current timestamp when timestamp is not provided', async () => {
      const before = Date.now()
      const changes = [
        { type: 'insert' as const, record: { id: 1 }, lsn: '0/1234' },
      ]

      const sync = createCDCSync({
        fetchChanges: async () => changes,
        streamName: 'users',
      })

      const messages: AirbyteMessage[] = []
      for await (const msg of sync.read({}, { streams: [{ name: 'users', syncMode: 'incremental' }] })) {
        messages.push(msg)
      }

      const records = messages.filter((m): m is RecordMessage => m.type === 'RECORD')
      const after = Date.now()
      expect(records[0].record.data._cdc_timestamp).toBeGreaterThanOrEqual(before)
      expect(records[0].record.data._cdc_timestamp).toBeLessThanOrEqual(after)
    })
  })

  describe('mixed change types', () => {
    it('should handle batch with all change types', async () => {
      const changes = [
        { type: 'insert' as const, record: { id: 1, name: 'Alice' }, lsn: '0/1234' },
        { type: 'update' as const, before: { id: 1, name: 'Alice' }, after: { id: 1, name: 'Alice Smith' }, lsn: '0/1235' },
        { type: 'delete' as const, record: { id: 2, name: 'Bob' }, lsn: '0/1236' },
        { type: 'insert' as const, record: { id: 3, name: 'Charlie' }, lsn: '0/1237' },
      ]

      const sync = createCDCSync({
        fetchChanges: async () => changes,
        streamName: 'users',
      })

      const messages: AirbyteMessage[] = []
      for await (const msg of sync.read({}, { streams: [{ name: 'users', syncMode: 'incremental' }] })) {
        messages.push(msg)
      }

      const records = messages.filter((m): m is RecordMessage => m.type === 'RECORD')
      expect(records).toHaveLength(4)
      expect(records[0].record.data._cdc_op).toBe('insert')
      expect(records[1].record.data._cdc_op).toBe('update')
      expect(records[2].record.data._cdc_op).toBe('delete')
      expect(records[3].record.data._cdc_op).toBe('insert')
    })
  })

  describe('empty batch handling', () => {
    it('should handle empty change batch gracefully', async () => {
      const sync = createCDCSync({
        fetchChanges: async () => [],
        streamName: 'users',
      })

      const messages: AirbyteMessage[] = []
      for await (const msg of sync.read({}, { streams: [{ name: 'users', syncMode: 'incremental' }] })) {
        messages.push(msg)
      }

      const records = messages.filter((m): m is RecordMessage => m.type === 'RECORD')
      const states = messages.filter((m): m is StateMessage => m.type === 'STATE')
      expect(records).toHaveLength(0)
      // No state emitted when no changes
      expect(states.filter(s => s.state.stream?.streamState.lsn)).toHaveLength(0)
    })
  })

  describe('LSN comparison edge cases', () => {
    it('should handle hex LSN values correctly when sorting', async () => {
      const changes = [
        { type: 'insert' as const, record: { id: 3 }, lsn: '0/FFFF' },
        { type: 'insert' as const, record: { id: 1 }, lsn: '0/1000' },
        { type: 'insert' as const, record: { id: 2 }, lsn: '0/A000' },
      ]

      const sync = createCDCSync({
        fetchChanges: async () => changes,
        streamName: 'users',
        sortByLsn: true,
      })

      const messages: AirbyteMessage[] = []
      for await (const msg of sync.read({}, { streams: [{ name: 'users', syncMode: 'incremental' }] })) {
        messages.push(msg)
      }

      const records = messages.filter((m): m is RecordMessage => m.type === 'RECORD')
      expect(records[0].record.data.id).toBe(1) // 0/1000
      expect(records[1].record.data.id).toBe(2) // 0/A000
      expect(records[2].record.data.id).toBe(3) // 0/FFFF
    })

    it('should handle multi-segment LSN values', async () => {
      const changes = [
        { type: 'insert' as const, record: { id: 2 }, lsn: '1/0' },
        { type: 'insert' as const, record: { id: 1 }, lsn: '0/FFFFFFFF' },
        { type: 'insert' as const, record: { id: 3 }, lsn: '1/1000' },
      ]

      const sync = createCDCSync({
        fetchChanges: async () => changes,
        streamName: 'users',
        sortByLsn: true,
      })

      const messages: AirbyteMessage[] = []
      for await (const msg of sync.read({}, { streams: [{ name: 'users', syncMode: 'incremental' }] })) {
        messages.push(msg)
      }

      const records = messages.filter((m): m is RecordMessage => m.type === 'RECORD')
      // String comparison: 0/FFFFFFFF < 1/0 < 1/1000
      expect(records[0].record.data.id).toBe(1)
      expect(records[1].record.data.id).toBe(2)
      expect(records[2].record.data.id).toBe(3)
    })
  })

  describe('snapshot with startLsn', () => {
    it('should use startLsn for CDC resumption after snapshot', async () => {
      const snapshotData = [{ id: 1 }, { id: 2 }]
      const cdcChanges = [
        { type: 'insert' as const, record: { id: 3 }, lsn: '0/2000' },
      ]

      const sync = createCDCSync({
        fetchChanges: async (lsn) => {
          // Should receive the startLsn from snapshot config
          if (lsn === '0/1000') {
            return cdcChanges
          }
          return []
        },
        streamName: 'users',
        initialSnapshot: {
          enabled: true,
          fetchSnapshot: async () => snapshotData,
          startLsn: '0/1000',
        },
      })

      const messages: AirbyteMessage[] = []
      for await (const msg of sync.read({}, { streams: [{ name: 'users', syncMode: 'incremental' }] })) {
        messages.push(msg)
      }

      const states = messages.filter((m): m is StateMessage => m.type === 'STATE')
      // After snapshot, state should contain startLsn
      const snapshotState = states.find(s => s.state.stream?.streamState.snapshotComplete === true)
      expect(snapshotState?.state.stream?.streamState.lsn).toBe('0/1000')
    })
  })

  describe('update record structure', () => {
    it('should preserve all fields from after in update records', async () => {
      const changes = [
        {
          type: 'update' as const,
          before: { id: 1, name: 'Alice', email: 'alice@old.com', age: 25 },
          after: { id: 1, name: 'Alice Smith', email: 'alice@new.com', age: 26 },
          lsn: '0/1234',
        },
      ]

      const sync = createCDCSync({
        fetchChanges: async () => changes,
        streamName: 'users',
      })

      const messages: AirbyteMessage[] = []
      for await (const msg of sync.read({}, { streams: [{ name: 'users', syncMode: 'incremental' }] })) {
        messages.push(msg)
      }

      const records = messages.filter((m): m is RecordMessage => m.type === 'RECORD')
      expect(records[0].record.data.id).toBe(1)
      expect(records[0].record.data.name).toBe('Alice Smith')
      expect(records[0].record.data.email).toBe('alice@new.com')
      expect(records[0].record.data.age).toBe(26)
    })
  })

  describe('progress tracking', () => {
    it('should track progress correctly across all CDC operations', async () => {
      const changes = [
        { type: 'insert' as const, record: { id: 1, name: 'Alice' }, lsn: '0/1234' },
        { type: 'update' as const, before: { id: 1 }, after: { id: 1, name: 'Alice Updated' }, lsn: '0/1235' },
        { type: 'delete' as const, record: { id: 2 }, lsn: '0/1236' },
      ]

      const sync = createCDCSync({
        fetchChanges: async () => changes,
        streamName: 'users',
      })

      for await (const _ of sync.read({}, { streams: [{ name: 'users', syncMode: 'incremental' }] })) {
        // consume
      }

      const progress = sync.getProgress()
      expect(progress.recordsEmitted).toBe(3)
      expect(progress.bytesEmitted).toBeGreaterThan(0)
      expect(progress.status).toBe('completed')
    })
  })

  describe('offset tracking without LSN', () => {
    it('should track only offset when LSN is not present', async () => {
      const changes = [
        { type: 'insert' as const, record: { id: 1 }, offset: 1000 },
        { type: 'insert' as const, record: { id: 2 }, offset: 1001 },
      ]

      const sync = createCDCSync({
        fetchChanges: async () => changes,
        streamName: 'events',
      })

      const messages: AirbyteMessage[] = []
      for await (const msg of sync.read({}, { streams: [{ name: 'events', syncMode: 'incremental' }] })) {
        messages.push(msg)
      }

      const states = messages.filter((m): m is StateMessage => m.type === 'STATE')
      const finalState = states[states.length - 1]
      expect(finalState.state.stream?.streamState.offset).toBe(1001)
      expect(finalState.state.stream?.streamState.lsn).toBeUndefined()
    })
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('Sync Modes Integration', () => {
  it('should use correct sync mode based on catalog configuration', async () => {
    // Test that the framework correctly dispatches to the right sync mode
    const fullRefreshSync = createFullRefreshSync({
      fetchRecords: async () => [{ id: 1 }],
      streamName: 'users',
    })

    const incrementalSync = createIncrementalSync({
      fetchRecords: async () => [{ id: 1, updated_at: '2024-01-01' }],
      streamName: 'users',
      cursorField: 'updated_at',
    })

    // Full refresh should not use state
    const fullRefreshMessages: AirbyteMessage[] = []
    for await (const msg of fullRefreshSync.read(
      {},
      { streams: [{ name: 'users', syncMode: 'full_refresh' }] },
      { streams: { users: { cursor: 'ignored' } } },
    )) {
      fullRefreshMessages.push(msg)
    }

    // Incremental should use state
    const incrementalMessages: AirbyteMessage[] = []
    for await (const msg of incrementalSync.read(
      {},
      { streams: [{ name: 'users', syncMode: 'incremental' }] },
    )) {
      incrementalMessages.push(msg)
    }

    expect(fullRefreshMessages.filter((m) => m.type === 'RECORD')).toHaveLength(1)
    expect(incrementalMessages.filter((m) => m.type === 'RECORD')).toHaveLength(1)
  })
})
