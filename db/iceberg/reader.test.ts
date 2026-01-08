/**
 * Tests for IcebergReader - Direct Iceberg table navigation
 *
 * RED phase: These tests should fail until implementation is complete.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { IcebergReader } from './reader'
import type {
  IcebergMetadata,
  ManifestList,
  ManifestFile,
  DataFileEntry,
  FindFileResult,
  IcebergRecord,
} from './types'

/**
 * Mock R2Bucket for testing
 */
interface MockR2Object {
  key: string
  body: ReadableStream
  text(): Promise<string>
  json<T>(): Promise<T>
  arrayBuffer(): Promise<ArrayBuffer>
}

interface MockR2Bucket {
  get: Mock<(key: string) => Promise<MockR2Object | null>>
  head: Mock<(key: string) => Promise<{ key: string } | null>>
  list: Mock<() => Promise<{ objects: Array<{ key: string }> }>>
}

function createMockR2Bucket(): MockR2Bucket {
  return {
    get: vi.fn(),
    head: vi.fn(),
    list: vi.fn(),
  }
}

function createMockR2Object(key: string, data: unknown): MockR2Object {
  const json = JSON.stringify(data)
  const encoder = new TextEncoder()
  const uint8 = encoder.encode(json)

  return {
    key,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(uint8)
        controller.close()
      },
    }),
    text: vi.fn().mockResolvedValue(json),
    json: vi.fn().mockResolvedValue(data),
    arrayBuffer: vi.fn().mockResolvedValue(uint8.buffer),
  }
}

/**
 * Sample Iceberg metadata for testing
 */
function createSampleMetadata(): IcebergMetadata {
  return {
    formatVersion: 2,
    tableUuid: 'test-table-uuid-1234',
    location: 'r2://dotdo-data/iceberg/do_resources',
    lastUpdatedMs: Date.now(),
    lastColumnId: 12,
    schemas: [
      {
        schemaId: 0,
        type: 'struct',
        fields: [
          { id: 1, name: 'ns', required: true, type: 'string' },
          { id: 2, name: 'type', required: true, type: 'string' },
          { id: 3, name: 'id', required: true, type: 'string' },
          { id: 4, name: 'ts', required: true, type: 'timestamp' },
          { id: 5, name: 'mdx', required: false, type: 'string' },
          { id: 6, name: 'data', required: false, type: 'string' },
          { id: 7, name: 'esm', required: false, type: 'string' },
          { id: 8, name: 'dts', required: false, type: 'string' },
          { id: 9, name: 'mdast', required: false, type: 'string' },
          { id: 10, name: 'hast', required: false, type: 'string' },
          { id: 11, name: 'estree', required: false, type: 'string' },
          { id: 12, name: 'html', required: false, type: 'string' },
        ],
      },
    ],
    currentSchemaId: 0,
    partitionSpecs: [
      {
        specId: 0,
        fields: [
          { sourceId: 1, fieldId: 1000, name: 'ns', transform: 'identity' },
          { sourceId: 2, fieldId: 1001, name: 'type', transform: 'identity' },
        ],
      },
    ],
    defaultSpecId: 0,
    lastPartitionId: 1001,
    currentSnapshotId: 1001,
    snapshots: [
      {
        snapshotId: 1001,
        parentSnapshotId: null,
        sequenceNumber: 1,
        timestampMs: Date.now(),
        manifestList: 'iceberg/do_resources/metadata/snap-1001-manifest-list.avro',
        summary: { operation: 'append' },
      },
    ],
  }
}

/**
 * Sample manifest list for testing
 */
function createSampleManifestList(): ManifestList {
  return {
    manifests: [
      {
        manifestPath: 'iceberg/do_resources/metadata/manifest-1.avro',
        manifestLength: 4096,
        partitionSpecId: 0,
        sequenceNumber: 1,
        addedSnapshotId: 1001,
        addedFilesCount: 2,
        existingFilesCount: 0,
        deletedFilesCount: 0,
        partitions: [
          {
            containsNull: false,
            lowerBound: 'payments.do',
            upperBound: 'payments.do',
          },
          {
            containsNull: false,
            lowerBound: 'Function',
            upperBound: 'Function',
          },
        ],
      },
      {
        manifestPath: 'iceberg/do_resources/metadata/manifest-2.avro',
        manifestLength: 4096,
        partitionSpecId: 0,
        sequenceNumber: 1,
        addedSnapshotId: 1001,
        addedFilesCount: 1,
        existingFilesCount: 0,
        deletedFilesCount: 0,
        partitions: [
          {
            containsNull: false,
            lowerBound: 'orders.do',
            upperBound: 'orders.do',
          },
          {
            containsNull: false,
            lowerBound: 'Schema',
            upperBound: 'Schema',
          },
        ],
      },
    ],
  }
}

/**
 * Sample data file entries for testing
 */
function createSampleDataFileEntries(): DataFileEntry[] {
  return [
    {
      status: 1,
      filePath: 'iceberg/do_resources/data/ns=payments.do/type=Function/00001.parquet',
      fileFormat: 'PARQUET',
      partition: { ns: 'payments.do', type: 'Function' },
      recordCount: 10,
      fileSizeBytes: 8192,
      lowerBounds: { 3: 'charge' }, // id column lower bound
      upperBounds: { 3: 'refund' }, // id column upper bound
    },
    {
      status: 1,
      filePath: 'iceberg/do_resources/data/ns=payments.do/type=Function/00002.parquet',
      fileFormat: 'PARQUET',
      partition: { ns: 'payments.do', type: 'Function' },
      recordCount: 5,
      fileSizeBytes: 4096,
      lowerBounds: { 3: 'subscribe' },
      upperBounds: { 3: 'webhook' },
    },
  ]
}

/**
 * Sample record for testing
 */
function createSampleRecord(): IcebergRecord {
  return {
    ns: 'payments.do',
    type: 'Function',
    id: 'charge',
    ts: '2024-01-15T10:30:00Z',
    mdx: '# Charge Function\n\nProcesses payment charges.',
    esm: 'export async function charge(amount) { return { success: true } }',
    dts: 'export function charge(amount: number): Promise<{ success: boolean }>',
    html: '<h1>Charge Function</h1><p>Processes payment charges.</p>',
  }
}

describe('IcebergReader', () => {
  let mockBucket: MockR2Bucket
  let reader: IcebergReader

  beforeEach(() => {
    mockBucket = createMockR2Bucket()
    reader = new IcebergReader(mockBucket as unknown as import('@cloudflare/workers-types').R2Bucket)
  })

  describe('constructor', () => {
    it('accepts R2Bucket as first argument', () => {
      const r = new IcebergReader(mockBucket as unknown as import('@cloudflare/workers-types').R2Bucket)
      expect(r).toBeInstanceOf(IcebergReader)
    })

    it('accepts options object with bucket property', () => {
      const r = new IcebergReader({
        bucket: mockBucket as unknown as import('@cloudflare/workers-types').R2Bucket,
        basePath: 'custom/',
        cacheMetadata: false,
      })
      expect(r).toBeInstanceOf(IcebergReader)
    })

    it('accepts R2Bucket with optional config', () => {
      const r = new IcebergReader(
        mockBucket as unknown as import('@cloudflare/workers-types').R2Bucket,
        { basePath: 'tables/' }
      )
      expect(r).toBeInstanceOf(IcebergReader)
    })
  })

  describe('findFile()', () => {
    it('returns correct data file path for existing record', async () => {
      // Setup mock responses
      const metadata = createSampleMetadata()
      const manifestList = createSampleManifestList()
      const dataFiles = createSampleDataFileEntries()

      mockBucket.get.mockImplementation(async (key: string) => {
        if (key.includes('metadata.json')) {
          return createMockR2Object(key, metadata)
        }
        if (key.includes('manifest-list.avro')) {
          return createMockR2Object(key, manifestList)
        }
        if (key.includes('manifest-1.avro')) {
          return createMockR2Object(key, { entries: dataFiles })
        }
        return null
      })

      const result = await reader.findFile({
        table: 'do_resources',
        partition: { ns: 'payments.do', type: 'Function' },
        id: 'charge',
      })

      expect(result).not.toBeNull()
      expect(result?.filePath).toBe(
        'iceberg/do_resources/data/ns=payments.do/type=Function/00001.parquet'
      )
      expect(result?.fileFormat).toBe('PARQUET')
      expect(result?.partition).toEqual({ ns: 'payments.do', type: 'Function' })
    })

    it('returns null for non-existent partition', async () => {
      const metadata = createSampleMetadata()
      const manifestList = createSampleManifestList()

      mockBucket.get.mockImplementation(async (key: string) => {
        if (key.includes('metadata.json')) {
          return createMockR2Object(key, metadata)
        }
        if (key.includes('manifest-list.avro')) {
          return createMockR2Object(key, manifestList)
        }
        return null
      })

      const result = await reader.findFile({
        table: 'do_resources',
        partition: { ns: 'nonexistent.do', type: 'Function' },
        id: 'anything',
      })

      expect(result).toBeNull()
    })

    it('returns null for non-existent record id', async () => {
      const metadata = createSampleMetadata()
      const manifestList = createSampleManifestList()
      const dataFiles = createSampleDataFileEntries()

      mockBucket.get.mockImplementation(async (key: string) => {
        if (key.includes('metadata.json')) {
          return createMockR2Object(key, metadata)
        }
        if (key.includes('manifest-list.avro')) {
          return createMockR2Object(key, manifestList)
        }
        if (key.includes('manifest-1.avro')) {
          return createMockR2Object(key, { entries: dataFiles })
        }
        return null
      })

      const result = await reader.findFile({
        table: 'do_resources',
        partition: { ns: 'payments.do', type: 'Function' },
        id: 'nonexistent-function',
      })

      expect(result).toBeNull()
    })

    it('uses column stats to find correct file when multiple files exist', async () => {
      const metadata = createSampleMetadata()
      const manifestList = createSampleManifestList()
      const dataFiles = createSampleDataFileEntries()

      mockBucket.get.mockImplementation(async (key: string) => {
        if (key.includes('metadata.json')) {
          return createMockR2Object(key, metadata)
        }
        if (key.includes('manifest-list.avro')) {
          return createMockR2Object(key, manifestList)
        }
        if (key.includes('manifest-1.avro')) {
          return createMockR2Object(key, { entries: dataFiles })
        }
        return null
      })

      // 'webhook' should be in the second file (upperBound)
      const result = await reader.findFile({
        table: 'do_resources',
        partition: { ns: 'payments.do', type: 'Function' },
        id: 'webhook',
      })

      expect(result).not.toBeNull()
      expect(result?.filePath).toBe(
        'iceberg/do_resources/data/ns=payments.do/type=Function/00002.parquet'
      )
    })

    it('supports custom snapshot id', async () => {
      const metadata: IcebergMetadata = {
        ...createSampleMetadata(),
        snapshots: [
          {
            snapshotId: 1000,
            timestampMs: Date.now() - 86400000,
            manifestList: 'iceberg/do_resources/metadata/snap-1000-manifest-list.avro',
          },
          {
            snapshotId: 1001,
            timestampMs: Date.now(),
            manifestList: 'iceberg/do_resources/metadata/snap-1001-manifest-list.avro',
          },
        ],
      }

      mockBucket.get.mockImplementation(async (key: string) => {
        if (key.includes('metadata.json')) {
          return createMockR2Object(key, metadata)
        }
        // Different manifest list for snapshot 1000
        if (key.includes('snap-1000')) {
          return createMockR2Object(key, { manifests: [] })
        }
        return null
      })

      const result = await reader.findFile({
        table: 'do_resources',
        partition: { ns: 'payments.do', type: 'Function' },
        id: 'charge',
        snapshotId: 1000,
      })

      // Should use older snapshot with empty manifests
      expect(result).toBeNull()
      expect(mockBucket.get).toHaveBeenCalledWith(
        expect.stringContaining('snap-1000')
      )
    })
  })

  describe('getRecord()', () => {
    it('returns parsed record data for existing record', async () => {
      const metadata = createSampleMetadata()
      const manifestList = createSampleManifestList()
      const dataFiles = createSampleDataFileEntries()
      const record = createSampleRecord()

      mockBucket.get.mockImplementation(async (key: string) => {
        if (key.includes('metadata.json')) {
          return createMockR2Object(key, metadata)
        }
        if (key.includes('manifest-list.avro')) {
          return createMockR2Object(key, manifestList)
        }
        if (key.includes('manifest-1.avro')) {
          return createMockR2Object(key, { entries: dataFiles })
        }
        if (key.includes('.parquet')) {
          // Mock parquet file with single record
          return createMockR2Object(key, { records: [record] })
        }
        return null
      })

      const result = await reader.getRecord({
        table: 'do_resources',
        partition: { ns: 'payments.do', type: 'Function' },
        id: 'charge',
      })

      expect(result).not.toBeNull()
      expect(result?.ns).toBe('payments.do')
      expect(result?.type).toBe('Function')
      expect(result?.id).toBe('charge')
      expect(result?.mdx).toContain('Charge Function')
      expect(result?.esm).toContain('export async function')
    })

    it('returns null for non-existent record', async () => {
      const metadata = createSampleMetadata()
      const manifestList = createSampleManifestList()
      const dataFiles = createSampleDataFileEntries()

      mockBucket.get.mockImplementation(async (key: string) => {
        if (key.includes('metadata.json')) {
          return createMockR2Object(key, metadata)
        }
        if (key.includes('manifest-list.avro')) {
          return createMockR2Object(key, manifestList)
        }
        if (key.includes('manifest-1.avro')) {
          return createMockR2Object(key, { entries: dataFiles })
        }
        return null
      })

      const result = await reader.getRecord({
        table: 'do_resources',
        partition: { ns: 'payments.do', type: 'Function' },
        id: 'nonexistent',
      })

      expect(result).toBeNull()
    })

    it('supports column selection', async () => {
      const metadata = createSampleMetadata()
      const manifestList = createSampleManifestList()
      const dataFiles = createSampleDataFileEntries()
      const record = createSampleRecord()

      mockBucket.get.mockImplementation(async (key: string) => {
        if (key.includes('metadata.json')) {
          return createMockR2Object(key, metadata)
        }
        if (key.includes('manifest-list.avro')) {
          return createMockR2Object(key, manifestList)
        }
        if (key.includes('manifest-1.avro')) {
          return createMockR2Object(key, { entries: dataFiles })
        }
        if (key.includes('.parquet')) {
          return createMockR2Object(key, { records: [record] })
        }
        return null
      })

      const result = await reader.getRecord({
        table: 'do_resources',
        partition: { ns: 'payments.do', type: 'Function' },
        id: 'charge',
        columns: ['id', 'esm', 'dts'],
      })

      expect(result).not.toBeNull()
      expect(result?.id).toBe('charge')
      expect(result?.esm).toBeDefined()
      expect(result?.dts).toBeDefined()
      // mdx and html should not be fetched (column selection optimization)
    })

    it('returns typed record when generic is specified', async () => {
      interface FunctionRecord extends IcebergRecord {
        esm: string
        dts: string
      }

      const metadata = createSampleMetadata()
      const manifestList = createSampleManifestList()
      const dataFiles = createSampleDataFileEntries()
      const record = createSampleRecord()

      mockBucket.get.mockImplementation(async (key: string) => {
        if (key.includes('metadata.json')) {
          return createMockR2Object(key, metadata)
        }
        if (key.includes('manifest-list.avro')) {
          return createMockR2Object(key, manifestList)
        }
        if (key.includes('manifest-1.avro')) {
          return createMockR2Object(key, { entries: dataFiles })
        }
        if (key.includes('.parquet')) {
          return createMockR2Object(key, { records: [record] })
        }
        return null
      })

      const result = await reader.getRecord<FunctionRecord>({
        table: 'do_resources',
        partition: { ns: 'payments.do', type: 'Function' },
        id: 'charge',
      })

      expect(result).not.toBeNull()
      // TypeScript should know these are strings
      const esm: string = result!.esm
      const dts: string = result!.dts
      expect(esm).toContain('export')
      expect(dts).toContain('export')
    })
  })

  describe('getMetadata()', () => {
    it('loads and parses metadata.json', async () => {
      const metadata = createSampleMetadata()

      mockBucket.get.mockImplementation(async (key: string) => {
        if (key.includes('metadata.json')) {
          return createMockR2Object(key, metadata)
        }
        return null
      })

      const result = await reader.getMetadata('do_resources')

      expect(result).toBeDefined()
      expect(result.formatVersion).toBe(2)
      expect(result.tableUuid).toBe('test-table-uuid-1234')
      expect(result.currentSnapshotId).toBe(1001)
      expect(result.schemas[0].fields).toHaveLength(12)
    })

    it('caches metadata by default', async () => {
      const metadata = createSampleMetadata()

      mockBucket.get.mockImplementation(async (key: string) => {
        if (key.includes('metadata.json')) {
          return createMockR2Object(key, metadata)
        }
        return null
      })

      // First call
      await reader.getMetadata('do_resources')
      // Second call should use cache
      await reader.getMetadata('do_resources')

      // Should only fetch once
      expect(mockBucket.get).toHaveBeenCalledTimes(1)
    })

    it('throws error for non-existent table', async () => {
      mockBucket.get.mockResolvedValue(null)

      await expect(reader.getMetadata('nonexistent_table')).rejects.toThrow()
    })
  })

  describe('clearCache()', () => {
    it('clears cached metadata', async () => {
      const metadata = createSampleMetadata()

      mockBucket.get.mockImplementation(async (key: string) => {
        if (key.includes('metadata.json')) {
          return createMockR2Object(key, metadata)
        }
        return null
      })

      // Populate cache
      await reader.getMetadata('do_resources')
      expect(mockBucket.get).toHaveBeenCalledTimes(1)

      // Clear cache
      reader.clearCache()

      // Should fetch again
      await reader.getMetadata('do_resources')
      expect(mockBucket.get).toHaveBeenCalledTimes(2)
    })
  })

  describe('Full navigation chain integration', () => {
    it('navigates metadata -> manifest-list -> manifest -> data file', async () => {
      const metadata = createSampleMetadata()
      const manifestList = createSampleManifestList()
      const dataFiles = createSampleDataFileEntries()
      const record = createSampleRecord()

      const callOrder: string[] = []

      mockBucket.get.mockImplementation(async (key: string) => {
        callOrder.push(key)

        if (key.includes('metadata.json')) {
          return createMockR2Object(key, metadata)
        }
        if (key.includes('manifest-list.avro')) {
          return createMockR2Object(key, manifestList)
        }
        if (key.includes('manifest-1.avro')) {
          return createMockR2Object(key, { entries: dataFiles })
        }
        if (key.includes('.parquet')) {
          return createMockR2Object(key, { records: [record] })
        }
        return null
      })

      const result = await reader.getRecord({
        table: 'do_resources',
        partition: { ns: 'payments.do', type: 'Function' },
        id: 'charge',
      })

      expect(result).not.toBeNull()

      // Verify navigation order
      expect(callOrder[0]).toContain('metadata.json')
      expect(callOrder[1]).toContain('manifest-list.avro')
      expect(callOrder[2]).toContain('manifest-1.avro')
      expect(callOrder[3]).toContain('.parquet')
    })

    it('prunes manifests by partition before reading', async () => {
      const metadata = createSampleMetadata()
      const manifestList = createSampleManifestList()
      const paymentsDataFiles = createSampleDataFileEntries()

      mockBucket.get.mockImplementation(async (key: string) => {
        if (key.includes('metadata.json')) {
          return createMockR2Object(key, metadata)
        }
        if (key.includes('manifest-list.avro')) {
          return createMockR2Object(key, manifestList)
        }
        if (key.includes('manifest-1.avro')) {
          return createMockR2Object(key, { entries: paymentsDataFiles })
        }
        if (key.includes('manifest-2.avro')) {
          // This should NOT be called for payments.do lookups
          throw new Error('Should not read manifest-2.avro for payments.do partition')
        }
        return null
      })

      await reader.findFile({
        table: 'do_resources',
        partition: { ns: 'payments.do', type: 'Function' },
        id: 'charge',
      })

      // manifest-2.avro is for orders.do/Schema, should be pruned
      const calls = mockBucket.get.mock.calls.map(([key]) => key)
      expect(calls).not.toContain(expect.stringContaining('manifest-2.avro'))
    })

    it('handles empty table gracefully', async () => {
      const emptyMetadata: IcebergMetadata = {
        ...createSampleMetadata(),
        currentSnapshotId: null,
        snapshots: [],
      }

      mockBucket.get.mockImplementation(async (key: string) => {
        if (key.includes('metadata.json')) {
          return createMockR2Object(key, emptyMetadata)
        }
        return null
      })

      const result = await reader.findFile({
        table: 'do_resources',
        partition: { ns: 'payments.do', type: 'Function' },
        id: 'charge',
      })

      expect(result).toBeNull()
    })

    it('handles table with no matching partitions', async () => {
      const metadata = createSampleMetadata()
      const manifestList: ManifestList = {
        manifests: [
          {
            manifestPath: 'iceberg/do_resources/metadata/manifest-other.avro',
            manifestLength: 4096,
            partitionSpecId: 0,
            addedSnapshotId: 1001,
            partitions: [
              { containsNull: false, lowerBound: 'other.do', upperBound: 'other.do' },
              { containsNull: false, lowerBound: 'Schema', upperBound: 'Schema' },
            ],
          },
        ],
      }

      mockBucket.get.mockImplementation(async (key: string) => {
        if (key.includes('metadata.json')) {
          return createMockR2Object(key, metadata)
        }
        if (key.includes('manifest-list.avro')) {
          return createMockR2Object(key, manifestList)
        }
        return null
      })

      const result = await reader.findFile({
        table: 'do_resources',
        partition: { ns: 'payments.do', type: 'Function' },
        id: 'charge',
      })

      expect(result).toBeNull()
    })
  })
})
