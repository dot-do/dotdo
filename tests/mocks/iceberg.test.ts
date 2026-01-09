/**
 * Tests for MockIcebergReader - Test fixture infrastructure
 *
 * These tests verify that the mock implementation:
 * 1. Returns seeded data correctly
 * 2. Supports partition filtering
 * 3. Tracks read operations for assertions
 * 4. Integrates with the real IcebergReader interface
 *
 * @module tests/mocks/iceberg.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  MockIcebergReader,
  createMockIcebergReader,
  type SeededData,
  type TrackedReadOperation,
} from './iceberg'
import type { IcebergRecord, PartitionFilter } from '../../db/iceberg/types'

// ============================================================================
// Test Fixtures
// ============================================================================

interface TestRecord extends IcebergRecord {
  esm?: string
  dts?: string
  html?: string
}

function createTestRecords(): TestRecord[] {
  return [
    {
      ns: 'payments.do',
      type: 'Function',
      id: 'charge',
      ts: '2024-01-15T10:30:00Z',
      esm: 'export async function charge() {}',
      dts: 'export function charge(): Promise<void>',
    },
    {
      ns: 'payments.do',
      type: 'Function',
      id: 'refund',
      ts: '2024-01-15T11:00:00Z',
      esm: 'export async function refund() {}',
      dts: 'export function refund(): Promise<void>',
    },
    {
      ns: 'payments.do',
      type: 'Schema',
      id: 'payment',
      ts: '2024-01-15T09:00:00Z',
    },
    {
      ns: 'orders.do',
      type: 'Function',
      id: 'create',
      ts: '2024-01-15T12:00:00Z',
      esm: 'export async function create() {}',
    },
    {
      ns: 'orders.do',
      type: 'Schema',
      id: 'order',
      ts: '2024-01-15T08:00:00Z',
    },
  ]
}

function createSeededData(): SeededData<TestRecord> {
  return {
    do_resources: createTestRecords(),
    do_events: [
      {
        ns: 'payments.do',
        type: 'Event',
        id: 'payment.created',
        ts: '2024-01-15T13:00:00Z',
      },
    ],
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('MockIcebergReader', () => {
  describe('constructor', () => {
    it('creates instance with empty data by default', () => {
      const mock = new MockIcebergReader()
      expect(mock.getData()).toEqual({})
    })

    it('accepts seeded data in constructor', () => {
      const data = createSeededData()
      const mock = new MockIcebergReader({ data })

      expect(mock.getData()).toEqual(data)
    })

    it('accepts options for tracking and latency', () => {
      const mock = new MockIcebergReader({
        trackReads: false,
        latencyMs: 10,
        throwOnMissingTable: true,
      })

      // Mock should be created without error
      expect(mock).toBeInstanceOf(MockIcebergReader)
    })
  })

  describe('getRecord()', () => {
    let mock: MockIcebergReader<TestRecord>

    beforeEach(() => {
      mock = new MockIcebergReader({ data: createSeededData() })
    })

    it('returns seeded record by partition and id', async () => {
      const record = await mock.getRecord({
        table: 'do_resources',
        partition: { ns: 'payments.do', type: 'Function' },
        id: 'charge',
      })

      expect(record).not.toBeNull()
      expect(record?.ns).toBe('payments.do')
      expect(record?.type).toBe('Function')
      expect(record?.id).toBe('charge')
      expect(record?.esm).toContain('export async function charge')
    })

    it('returns null for non-existent record', async () => {
      const record = await mock.getRecord({
        table: 'do_resources',
        partition: { ns: 'payments.do', type: 'Function' },
        id: 'nonexistent',
      })

      expect(record).toBeNull()
    })

    it('returns null for non-existent partition', async () => {
      const record = await mock.getRecord({
        table: 'do_resources',
        partition: { ns: 'unknown.do', type: 'Function' },
        id: 'charge',
      })

      expect(record).toBeNull()
    })

    it('returns null for non-existent table', async () => {
      const record = await mock.getRecord({
        table: 'nonexistent_table',
        partition: { ns: 'payments.do', type: 'Function' },
        id: 'charge',
      })

      expect(record).toBeNull()
    })

    it('throws error for missing table when throwOnMissingTable is true', async () => {
      const strictMock = new MockIcebergReader({
        data: createSeededData(),
        throwOnMissingTable: true,
      })

      await expect(
        strictMock.getRecord({
          table: 'nonexistent_table',
          partition: { ns: 'payments.do', type: 'Function' },
          id: 'charge',
        })
      ).rejects.toThrow('Table not found: nonexistent_table')
    })

    it('distinguishes between partitions with same id', async () => {
      // Add a record with same id but different partition
      mock.addRecords('do_resources', [
        {
          ns: 'orders.do',
          type: 'Function',
          id: 'charge',
          ts: '2024-01-16T10:00:00Z',
          esm: 'export async function chargeOrder() {}',
        },
      ])

      const paymentsCharge = await mock.getRecord({
        table: 'do_resources',
        partition: { ns: 'payments.do', type: 'Function' },
        id: 'charge',
      })

      const ordersCharge = await mock.getRecord({
        table: 'do_resources',
        partition: { ns: 'orders.do', type: 'Function' },
        id: 'charge',
      })

      expect(paymentsCharge?.esm).toContain('charge()')
      expect(ordersCharge?.esm).toContain('chargeOrder()')
    })
  })

  describe('getRecords() - partition filtering', () => {
    let mock: MockIcebergReader<TestRecord>

    beforeEach(() => {
      mock = new MockIcebergReader({ data: createSeededData() })
    })

    it('returns all records when no partition filter', async () => {
      const records = await mock.getRecords({
        table: 'do_resources',
      })

      expect(records).toHaveLength(5)
    })

    it('filters by namespace partition', async () => {
      const records = await mock.getRecords({
        table: 'do_resources',
        partition: { ns: 'payments.do' },
      })

      expect(records).toHaveLength(3)
      expect(records.every((r) => r.ns === 'payments.do')).toBe(true)
    })

    it('filters by type partition', async () => {
      const records = await mock.getRecords({
        table: 'do_resources',
        partition: { type: 'Function' },
      })

      expect(records).toHaveLength(3)
      expect(records.every((r) => r.type === 'Function')).toBe(true)
    })

    it('filters by both ns and type partition', async () => {
      const records = await mock.getRecords({
        table: 'do_resources',
        partition: { ns: 'payments.do', type: 'Function' },
      })

      expect(records).toHaveLength(2)
      expect(records.every((r) => r.ns === 'payments.do' && r.type === 'Function')).toBe(true)
    })

    it('returns empty array for non-matching partition', async () => {
      const records = await mock.getRecords({
        table: 'do_resources',
        partition: { ns: 'unknown.do', type: 'Function' },
      })

      expect(records).toEqual([])
    })

    it('respects limit parameter', async () => {
      const records = await mock.getRecords({
        table: 'do_resources',
        limit: 2,
      })

      expect(records).toHaveLength(2)
    })

    it('combines partition filter with limit', async () => {
      const records = await mock.getRecords({
        table: 'do_resources',
        partition: { ns: 'payments.do' },
        limit: 1,
      })

      expect(records).toHaveLength(1)
      expect(records[0].ns).toBe('payments.do')
    })
  })

  describe('findFile()', () => {
    let mock: MockIcebergReader<TestRecord>

    beforeEach(() => {
      mock = new MockIcebergReader({ data: createSeededData() })
    })

    it('returns file info for existing record', async () => {
      const result = await mock.findFile({
        table: 'do_resources',
        partition: { ns: 'payments.do', type: 'Function' },
        id: 'charge',
      })

      expect(result).not.toBeNull()
      expect(result?.filePath).toContain('iceberg/do_resources/data')
      expect(result?.filePath).toContain('ns=payments.do')
      expect(result?.filePath).toContain('type=Function')
      expect(result?.fileFormat).toBe('PARQUET')
      expect(result?.partition).toEqual({ ns: 'payments.do', type: 'Function' })
    })

    it('returns null for non-existent record', async () => {
      const result = await mock.findFile({
        table: 'do_resources',
        partition: { ns: 'payments.do', type: 'Function' },
        id: 'nonexistent',
      })

      expect(result).toBeNull()
    })
  })

  describe('read operation tracking', () => {
    let mock: MockIcebergReader<TestRecord>

    beforeEach(() => {
      mock = new MockIcebergReader({ data: createSeededData() })
    })

    it('tracks getRecord operations', async () => {
      await mock.getRecord({
        table: 'do_resources',
        partition: { ns: 'payments.do', type: 'Function' },
        id: 'charge',
      })

      expect(mock.getReadCount()).toBe(1)

      const lastRead = mock.getLastRead()
      expect(lastRead).toBeDefined()
      expect(lastRead?.type).toBe('getRecord')
      expect(lastRead?.table).toBe('do_resources')
      expect(lastRead?.partition).toEqual({ ns: 'payments.do', type: 'Function' })
      expect(lastRead?.id).toBe('charge')
      expect(lastRead?.timestamp).toBeLessThanOrEqual(Date.now())
    })

    it('tracks getRecords operations', async () => {
      await mock.getRecords({
        table: 'do_resources',
        partition: { ns: 'payments.do' },
      })

      expect(mock.getReadCount()).toBe(1)

      const lastRead = mock.getLastRead()
      expect(lastRead?.type).toBe('getRecords')
      expect(lastRead?.table).toBe('do_resources')
      expect(lastRead?.partition).toEqual({ ns: 'payments.do' })
    })

    it('tracks findFile operations', async () => {
      await mock.findFile({
        table: 'do_resources',
        partition: { ns: 'payments.do', type: 'Function' },
        id: 'charge',
      })

      expect(mock.getReadCount()).toBe(1)

      const lastRead = mock.getLastRead()
      expect(lastRead?.type).toBe('findFile')
    })

    it('tracks multiple operations in order', async () => {
      await mock.getRecord({
        table: 'do_resources',
        partition: { ns: 'payments.do', type: 'Function' },
        id: 'charge',
      })

      await mock.getRecords({
        table: 'do_events',
      })

      await mock.findFile({
        table: 'do_resources',
        partition: { ns: 'orders.do', type: 'Function' },
        id: 'create',
      })

      expect(mock.getReadCount()).toBe(3)

      const operations = mock.getReadOperations()
      expect(operations[0].type).toBe('getRecord')
      expect(operations[1].type).toBe('getRecords')
      expect(operations[2].type).toBe('findFile')
    })

    it('filters operations by type', async () => {
      await mock.getRecord({
        table: 'do_resources',
        partition: { ns: 'payments.do', type: 'Function' },
        id: 'charge',
      })

      await mock.getRecords({ table: 'do_resources' })
      await mock.getRecords({ table: 'do_events' })

      const getRecordsOps = mock.getReadsByType('getRecords')
      expect(getRecordsOps).toHaveLength(2)

      const getRecordOps = mock.getReadsByType('getRecord')
      expect(getRecordOps).toHaveLength(1)
    })

    it('filters operations by table', async () => {
      await mock.getRecord({
        table: 'do_resources',
        partition: { ns: 'payments.do', type: 'Function' },
        id: 'charge',
      })

      await mock.getRecords({ table: 'do_events' })

      const resourceOps = mock.getReadsByTable('do_resources')
      expect(resourceOps).toHaveLength(1)

      const eventOps = mock.getReadsByTable('do_events')
      expect(eventOps).toHaveLength(1)
    })

    it('hasRead() returns true for matching criteria', async () => {
      await mock.getRecord({
        table: 'do_resources',
        partition: { ns: 'payments.do', type: 'Function' },
        id: 'charge',
      })

      expect(
        mock.hasRead({
          type: 'getRecord',
          table: 'do_resources',
        })
      ).toBe(true)

      expect(
        mock.hasRead({
          table: 'do_resources',
          id: 'charge',
        })
      ).toBe(true)

      expect(
        mock.hasRead({
          partition: { ns: 'payments.do', type: 'Function' },
        })
      ).toBe(true)
    })

    it('hasRead() returns false for non-matching criteria', async () => {
      await mock.getRecord({
        table: 'do_resources',
        partition: { ns: 'payments.do', type: 'Function' },
        id: 'charge',
      })

      expect(
        mock.hasRead({
          type: 'getRecords',
        })
      ).toBe(false)

      expect(
        mock.hasRead({
          table: 'do_events',
        })
      ).toBe(false)

      expect(
        mock.hasRead({
          id: 'nonexistent',
        })
      ).toBe(false)
    })

    it('clearReads() clears tracked operations', async () => {
      await mock.getRecord({
        table: 'do_resources',
        partition: { ns: 'payments.do', type: 'Function' },
        id: 'charge',
      })

      expect(mock.getReadCount()).toBe(1)

      mock.clearReads()

      expect(mock.getReadCount()).toBe(0)
      expect(mock.getReadOperations()).toEqual([])
    })

    it('does not track reads when trackReads is false', async () => {
      const untracked = new MockIcebergReader({
        data: createSeededData(),
        trackReads: false,
      })

      await untracked.getRecord({
        table: 'do_resources',
        partition: { ns: 'payments.do', type: 'Function' },
        id: 'charge',
      })

      expect(untracked.getReadCount()).toBe(0)
    })
  })

  describe('data management', () => {
    let mock: MockIcebergReader<TestRecord>

    beforeEach(() => {
      mock = new MockIcebergReader()
    })

    it('addRecords() adds records to table', async () => {
      mock.addRecords('do_resources', [
        { ns: 'test.do', type: 'Function', id: 'foo', ts: new Date().toISOString() },
      ])

      const record = await mock.getRecord({
        table: 'do_resources',
        partition: { ns: 'test.do', type: 'Function' },
        id: 'foo',
      })

      expect(record).not.toBeNull()
    })

    it('addRecords() appends to existing data', async () => {
      mock.addRecords('do_resources', [
        { ns: 'test.do', type: 'Function', id: 'foo', ts: new Date().toISOString() },
      ])

      mock.addRecords('do_resources', [
        { ns: 'test.do', type: 'Function', id: 'bar', ts: new Date().toISOString() },
      ])

      const records = await mock.getRecords({ table: 'do_resources' })
      expect(records).toHaveLength(2)
    })

    it('setTableData() replaces existing data', async () => {
      mock.addRecords('do_resources', [
        { ns: 'old.do', type: 'Function', id: 'old', ts: new Date().toISOString() },
      ])

      mock.setTableData('do_resources', [
        { ns: 'new.do', type: 'Function', id: 'new', ts: new Date().toISOString() },
      ])

      const records = await mock.getRecords({ table: 'do_resources' })
      expect(records).toHaveLength(1)
      expect(records[0].ns).toBe('new.do')
    })

    it('clearData() removes all data', async () => {
      mock.addRecords('do_resources', createTestRecords())
      mock.addRecords('do_events', [
        { ns: 'test.do', type: 'Event', id: 'test', ts: new Date().toISOString() },
      ])

      mock.clearData()

      expect(mock.getData()).toEqual({})

      const records = await mock.getRecords({ table: 'do_resources' })
      expect(records).toEqual([])
    })

    it('getData() returns copy of data', () => {
      const originalData = createSeededData()
      const mockWithData = new MockIcebergReader({ data: originalData })

      const returnedData = mockWithData.getData()

      // Should be equal but not the same reference
      expect(returnedData).toEqual(originalData)
      expect(returnedData).not.toBe(originalData)
    })
  })

  describe('createMockIcebergReader factory', () => {
    it('creates mock with seeded data', async () => {
      const mock = createMockIcebergReader(createSeededData())

      const record = await mock.getRecord({
        table: 'do_resources',
        partition: { ns: 'payments.do', type: 'Function' },
        id: 'charge',
      })

      expect(record).not.toBeNull()
    })

    it('accepts additional options', async () => {
      const mock = createMockIcebergReader(createSeededData(), {
        trackReads: false,
        latencyMs: 0,
      })

      await mock.getRecord({
        table: 'do_resources',
        partition: { ns: 'payments.do', type: 'Function' },
        id: 'charge',
      })

      // Should not track reads
      expect(mock.getReadCount()).toBe(0)
    })
  })

  describe('IcebergReader interface compatibility', () => {
    it('implements findFile() with FindFileOptions', async () => {
      const mock = new MockIcebergReader({ data: createSeededData() })

      // Should accept the exact interface from db/iceberg/types
      const result = await mock.findFile({
        table: 'do_resources',
        partition: { ns: 'payments.do', type: 'Function' },
        id: 'charge',
        // snapshotId is optional in the interface
      })

      expect(result).not.toBeNull()
    })

    it('implements getRecord() with GetRecordOptions', async () => {
      const mock = new MockIcebergReader({ data: createSeededData() })

      // Should accept the exact interface from db/iceberg/types
      const result = await mock.getRecord({
        table: 'do_resources',
        partition: { ns: 'payments.do', type: 'Function' },
        id: 'charge',
        columns: ['id', 'esm', 'dts'], // Optional column selection
      })

      expect(result).not.toBeNull()
    })

    it('implements clearCache() for interface compatibility', () => {
      const mock = new MockIcebergReader()

      // Should not throw
      expect(() => mock.clearCache()).not.toThrow()
    })

    it('returns FindFileResult structure', async () => {
      const mock = new MockIcebergReader({ data: createSeededData() })

      const result = await mock.findFile({
        table: 'do_resources',
        partition: { ns: 'payments.do', type: 'Function' },
        id: 'charge',
      })

      // Verify all required fields in FindFileResult
      expect(result).toHaveProperty('filePath')
      expect(result).toHaveProperty('fileFormat')
      expect(result).toHaveProperty('recordCount')
      expect(result).toHaveProperty('fileSizeBytes')
      expect(result).toHaveProperty('partition')
    })

    it('returns IcebergRecord structure', async () => {
      const mock = new MockIcebergReader({ data: createSeededData() })

      const result = await mock.getRecord({
        table: 'do_resources',
        partition: { ns: 'payments.do', type: 'Function' },
        id: 'charge',
      })

      // Verify all required fields in IcebergRecord
      expect(result).toHaveProperty('ns')
      expect(result).toHaveProperty('type')
      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('ts')
    })
  })

  describe('latency simulation', () => {
    it('simulates latency when configured', async () => {
      const mock = new MockIcebergReader({
        data: createSeededData(),
        latencyMs: 50,
      })

      const start = Date.now()
      await mock.getRecord({
        table: 'do_resources',
        partition: { ns: 'payments.do', type: 'Function' },
        id: 'charge',
      })
      const elapsed = Date.now() - start

      expect(elapsed).toBeGreaterThanOrEqual(45) // Allow some tolerance
    })

    it('has no latency by default', async () => {
      const mock = new MockIcebergReader({ data: createSeededData() })

      const start = Date.now()
      await mock.getRecord({
        table: 'do_resources',
        partition: { ns: 'payments.do', type: 'Function' },
        id: 'charge',
      })
      const elapsed = Date.now() - start

      expect(elapsed).toBeLessThan(20) // Should be nearly instant
    })
  })
})
