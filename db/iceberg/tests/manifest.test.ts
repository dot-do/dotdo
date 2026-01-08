import { describe, it, expect } from 'vitest'
import {
  parseManifestList,
  parseManifestFile,
  filterManifestsByPartition,
  filterDataFilesByPartition,
  getManifestPaths,
  getDataFilePaths,
  type ManifestListEntry,
  type ManifestEntry,
  type DataFile,
  type PartitionFilter,
  type FieldSummary,
} from '../manifest'

/**
 * Iceberg Manifest Navigation Tests
 *
 * RED Phase TDD - these tests define the expected behavior for parsing
 * Iceberg manifest-list and manifest-file Avro structures.
 *
 * The implementation will enable direct navigation from R2 Data Catalog
 * for fast point lookups (50-150ms vs 500ms-2s through R2 SQL).
 *
 * Iceberg Navigation Chain:
 * 1. metadata.json -> current-snapshot-id -> manifest-list path
 * 2. manifest-list.avro -> filter by partition -> manifest-file paths
 * 3. manifest-file.avro -> filter by partition -> data-file paths
 * 4. data-file.parquet -> read record (optional)
 *
 * References:
 * - https://iceberg.apache.org/spec/#manifest-list
 * - https://iceberg.apache.org/spec/#manifest-files
 * - https://iceberg.apache.org/spec/#data-file-content
 */

// ============================================================================
// Test Fixtures - Sample Avro-like binary data structures
// ============================================================================

/**
 * Creates a mock Avro header for testing
 * Real Avro files start with: magic bytes (4) + schema + sync marker (16)
 */
function createMockAvroHeader(): Uint8Array {
  // Avro magic bytes: 'Obj\x01'
  const magic = new Uint8Array([0x4f, 0x62, 0x6a, 0x01])
  return magic
}

/**
 * Sample manifest-list entry representing a manifest file
 * This would be serialized as Avro in real Iceberg tables
 */
const sampleManifestListEntry: ManifestListEntry = {
  manifestPath: 's3://bucket/warehouse/db/table/metadata/snap-123-manifest-1.avro',
  manifestLength: 4096,
  partitionSpecId: 0,
  content: 0, // data files
  sequenceNumber: 1,
  minSequenceNumber: 1,
  addedSnapshotId: 123456789,
  addedFilesCount: 10,
  existingFilesCount: 0,
  deletedFilesCount: 0,
  addedRowsCount: 1000,
  existingRowsCount: 0,
  deletedRowsCount: 0,
  partitions: [
    {
      containsNull: false,
      containsNaN: false,
      lowerBound: new TextEncoder().encode('payments.do'),
      upperBound: new TextEncoder().encode('payments.do'),
    },
    {
      containsNull: false,
      containsNaN: false,
      lowerBound: new TextEncoder().encode('Function'),
      upperBound: new TextEncoder().encode('Function'),
    },
  ],
}

/**
 * Sample data file entry representing a Parquet file
 */
const sampleDataFile: DataFile = {
  content: 0, // DATA
  filePath: 's3://bucket/warehouse/db/table/data/ns=payments.do/type=Function/00001.parquet',
  fileFormat: 'parquet',
  partition: {
    ns: 'payments.do',
    type: 'Function',
  },
  recordCount: 100,
  fileSizeInBytes: 102400,
  columnSizes: new Map([
    [1, 1024],
    [2, 2048],
  ]),
  valueCounts: new Map([
    [1, 100],
    [2, 100],
  ]),
  nullValueCounts: new Map([
    [1, 0],
    [2, 5],
  ]),
  sortOrderId: 0,
}

/**
 * Sample manifest entry wrapping a data file
 */
const sampleManifestEntry: ManifestEntry = {
  status: 1, // ADDED
  snapshotId: 123456789,
  sequenceNumber: 1,
  fileSequenceNumber: 1,
  dataFile: sampleDataFile,
}

// ============================================================================
// parseManifestList Tests
// ============================================================================

describe('parseManifestList', () => {
  describe('basic parsing', () => {
    it('parses valid Avro manifest-list and returns entries', () => {
      // Create mock Avro data that represents a manifest list
      // In reality this would be proper Avro-encoded data
      const mockAvroData = createMockAvroHeader()

      // This should parse the Avro and return manifest list entries
      const entries = parseManifestList(mockAvroData)

      expect(entries).toBeInstanceOf(Array)
      expect(entries.length).toBeGreaterThan(0)
    })

    it('returns manifest file paths from parsed entries', () => {
      const mockAvroData = createMockAvroHeader()
      const entries = parseManifestList(mockAvroData)

      // Each entry should have a manifestPath
      entries.forEach((entry) => {
        expect(entry.manifestPath).toBeDefined()
        expect(typeof entry.manifestPath).toBe('string')
        expect(entry.manifestPath).toMatch(/\.avro$/)
      })
    })

    it('parses manifest length for each entry', () => {
      const mockAvroData = createMockAvroHeader()
      const entries = parseManifestList(mockAvroData)

      entries.forEach((entry) => {
        expect(entry.manifestLength).toBeDefined()
        expect(typeof entry.manifestLength).toBe('number')
        expect(entry.manifestLength).toBeGreaterThan(0)
      })
    })

    it('parses content type (data vs deletes)', () => {
      const mockAvroData = createMockAvroHeader()
      const entries = parseManifestList(mockAvroData)

      entries.forEach((entry) => {
        expect(entry.content).toBeDefined()
        expect([0, 1]).toContain(entry.content) // 0=data, 1=deletes
      })
    })

    it('parses sequence numbers', () => {
      const mockAvroData = createMockAvroHeader()
      const entries = parseManifestList(mockAvroData)

      entries.forEach((entry) => {
        expect(entry.sequenceNumber).toBeDefined()
        expect(typeof entry.sequenceNumber).toBe('number')
        expect(entry.minSequenceNumber).toBeDefined()
        expect(entry.minSequenceNumber).toBeLessThanOrEqual(entry.sequenceNumber)
      })
    })

    it('parses file counts (added, existing, deleted)', () => {
      const mockAvroData = createMockAvroHeader()
      const entries = parseManifestList(mockAvroData)

      entries.forEach((entry) => {
        expect(entry.addedFilesCount).toBeDefined()
        expect(entry.existingFilesCount).toBeDefined()
        expect(entry.deletedFilesCount).toBeDefined()
        expect(entry.addedFilesCount).toBeGreaterThanOrEqual(0)
        expect(entry.existingFilesCount).toBeGreaterThanOrEqual(0)
        expect(entry.deletedFilesCount).toBeGreaterThanOrEqual(0)
      })
    })

    it('parses row counts', () => {
      const mockAvroData = createMockAvroHeader()
      const entries = parseManifestList(mockAvroData)

      entries.forEach((entry) => {
        expect(entry.addedRowsCount).toBeDefined()
        expect(entry.existingRowsCount).toBeDefined()
        expect(entry.deletedRowsCount).toBeDefined()
      })
    })
  })

  describe('partition field summaries', () => {
    it('parses partition field summaries when present', () => {
      const mockAvroData = createMockAvroHeader()
      const entries = parseManifestList(mockAvroData)

      // At least some entries should have partition summaries for pruning
      const entriesWithPartitions = entries.filter((e) => e.partitions && e.partitions.length > 0)
      expect(entriesWithPartitions.length).toBeGreaterThan(0)
    })

    it('partition summaries contain containsNull flag', () => {
      const mockAvroData = createMockAvroHeader()
      const entries = parseManifestList(mockAvroData)

      entries.forEach((entry) => {
        if (entry.partitions) {
          entry.partitions.forEach((summary) => {
            expect(typeof summary.containsNull).toBe('boolean')
          })
        }
      })
    })

    it('partition summaries contain lower/upper bounds for pruning', () => {
      const mockAvroData = createMockAvroHeader()
      const entries = parseManifestList(mockAvroData)

      entries.forEach((entry) => {
        if (entry.partitions) {
          entry.partitions.forEach((summary) => {
            // Bounds are optional but should be Uint8Array when present
            if (summary.lowerBound) {
              expect(summary.lowerBound).toBeInstanceOf(Uint8Array)
            }
            if (summary.upperBound) {
              expect(summary.upperBound).toBeInstanceOf(Uint8Array)
            }
          })
        }
      })
    })
  })

  describe('error handling', () => {
    it('throws on empty input', () => {
      const emptyData = new Uint8Array(0)
      expect(() => parseManifestList(emptyData)).toThrow()
    })

    it('throws on invalid Avro magic bytes', () => {
      const invalidData = new Uint8Array([0x00, 0x00, 0x00, 0x00])
      expect(() => parseManifestList(invalidData)).toThrow()
    })

    it('throws on truncated data', () => {
      // Just the magic bytes without any content
      const truncatedData = new Uint8Array([0x4f, 0x62, 0x6a, 0x01])
      expect(() => parseManifestList(truncatedData)).toThrow()
    })
  })
})

// ============================================================================
// parseManifestFile Tests
// ============================================================================

describe('parseManifestFile', () => {
  describe('basic parsing', () => {
    it('parses valid Avro manifest and returns entries', () => {
      const mockAvroData = createMockAvroHeader()
      const entries = parseManifestFile(mockAvroData)

      expect(entries).toBeInstanceOf(Array)
      expect(entries.length).toBeGreaterThan(0)
    })

    it('returns manifest entries with status field', () => {
      const mockAvroData = createMockAvroHeader()
      const entries = parseManifestFile(mockAvroData)

      entries.forEach((entry) => {
        expect(entry.status).toBeDefined()
        expect([0, 1, 2]).toContain(entry.status) // EXISTING, ADDED, DELETED
      })
    })

    it('returns manifest entries with snapshot ID', () => {
      const mockAvroData = createMockAvroHeader()
      const entries = parseManifestFile(mockAvroData)

      entries.forEach((entry) => {
        expect(entry.snapshotId).toBeDefined()
        expect(typeof entry.snapshotId).toBe('number')
      })
    })

    it('returns manifest entries with data file metadata', () => {
      const mockAvroData = createMockAvroHeader()
      const entries = parseManifestFile(mockAvroData)

      entries.forEach((entry) => {
        expect(entry.dataFile).toBeDefined()
        expect(typeof entry.dataFile).toBe('object')
      })
    })
  })

  describe('data file parsing', () => {
    it('parses file path from data file', () => {
      const mockAvroData = createMockAvroHeader()
      const entries = parseManifestFile(mockAvroData)

      entries.forEach((entry) => {
        expect(entry.dataFile.filePath).toBeDefined()
        expect(typeof entry.dataFile.filePath).toBe('string')
        // Should be a valid path (could be S3, R2, local, etc.)
        expect(entry.dataFile.filePath.length).toBeGreaterThan(0)
      })
    })

    it('parses file format (parquet, avro, orc)', () => {
      const mockAvroData = createMockAvroHeader()
      const entries = parseManifestFile(mockAvroData)

      entries.forEach((entry) => {
        expect(entry.dataFile.fileFormat).toBeDefined()
        expect(['avro', 'orc', 'parquet', 'puffin']).toContain(entry.dataFile.fileFormat)
      })
    })

    it('parses partition tuple from data file', () => {
      const mockAvroData = createMockAvroHeader()
      const entries = parseManifestFile(mockAvroData)

      entries.forEach((entry) => {
        expect(entry.dataFile.partition).toBeDefined()
        expect(typeof entry.dataFile.partition).toBe('object')
      })
    })

    it('parses record count from data file', () => {
      const mockAvroData = createMockAvroHeader()
      const entries = parseManifestFile(mockAvroData)

      entries.forEach((entry) => {
        expect(entry.dataFile.recordCount).toBeDefined()
        expect(typeof entry.dataFile.recordCount).toBe('number')
        expect(entry.dataFile.recordCount).toBeGreaterThanOrEqual(0)
      })
    })

    it('parses file size from data file', () => {
      const mockAvroData = createMockAvroHeader()
      const entries = parseManifestFile(mockAvroData)

      entries.forEach((entry) => {
        expect(entry.dataFile.fileSizeInBytes).toBeDefined()
        expect(typeof entry.dataFile.fileSizeInBytes).toBe('number')
        expect(entry.dataFile.fileSizeInBytes).toBeGreaterThan(0)
      })
    })

    it('parses content type (DATA, POSITION_DELETES, EQUALITY_DELETES)', () => {
      const mockAvroData = createMockAvroHeader()
      const entries = parseManifestFile(mockAvroData)

      entries.forEach((entry) => {
        expect(entry.dataFile.content).toBeDefined()
        expect([0, 1, 2]).toContain(entry.dataFile.content)
      })
    })
  })

  describe('column statistics', () => {
    it('parses column sizes map when present', () => {
      const mockAvroData = createMockAvroHeader()
      const entries = parseManifestFile(mockAvroData)

      entries.forEach((entry) => {
        if (entry.dataFile.columnSizes) {
          expect(entry.dataFile.columnSizes).toBeInstanceOf(Map)
        }
      })
    })

    it('parses value counts map when present', () => {
      const mockAvroData = createMockAvroHeader()
      const entries = parseManifestFile(mockAvroData)

      entries.forEach((entry) => {
        if (entry.dataFile.valueCounts) {
          expect(entry.dataFile.valueCounts).toBeInstanceOf(Map)
        }
      })
    })

    it('parses null value counts map when present', () => {
      const mockAvroData = createMockAvroHeader()
      const entries = parseManifestFile(mockAvroData)

      entries.forEach((entry) => {
        if (entry.dataFile.nullValueCounts) {
          expect(entry.dataFile.nullValueCounts).toBeInstanceOf(Map)
        }
      })
    })

    it('parses lower bounds map when present', () => {
      const mockAvroData = createMockAvroHeader()
      const entries = parseManifestFile(mockAvroData)

      entries.forEach((entry) => {
        if (entry.dataFile.lowerBounds) {
          expect(entry.dataFile.lowerBounds).toBeInstanceOf(Map)
          // Values should be Uint8Array (binary-encoded)
          for (const value of entry.dataFile.lowerBounds.values()) {
            expect(value).toBeInstanceOf(Uint8Array)
          }
        }
      })
    })

    it('parses upper bounds map when present', () => {
      const mockAvroData = createMockAvroHeader()
      const entries = parseManifestFile(mockAvroData)

      entries.forEach((entry) => {
        if (entry.dataFile.upperBounds) {
          expect(entry.dataFile.upperBounds).toBeInstanceOf(Map)
          for (const value of entry.dataFile.upperBounds.values()) {
            expect(value).toBeInstanceOf(Uint8Array)
          }
        }
      })
    })
  })

  describe('error handling', () => {
    it('throws on empty input', () => {
      const emptyData = new Uint8Array(0)
      expect(() => parseManifestFile(emptyData)).toThrow()
    })

    it('throws on invalid Avro magic bytes', () => {
      const invalidData = new Uint8Array([0xff, 0xff, 0xff, 0xff])
      expect(() => parseManifestFile(invalidData)).toThrow()
    })
  })
})

// ============================================================================
// Partition Pruning Tests
// ============================================================================

describe('filterManifestsByPartition', () => {
  // Sample partition spec mapping field names to Iceberg field IDs
  const partitionSpec = {
    ns: 1000, // namespace partition field
    type: 1001, // type partition field
  }

  describe('filtering by ns (namespace)', () => {
    it('returns manifests containing the specified namespace', () => {
      const entries: ManifestListEntry[] = [
        {
          ...sampleManifestListEntry,
          manifestPath: 's3://bucket/manifest-1.avro',
          partitions: [
            {
              containsNull: false,
              lowerBound: new TextEncoder().encode('payments.do'),
              upperBound: new TextEncoder().encode('payments.do'),
            },
          ],
        },
        {
          ...sampleManifestListEntry,
          manifestPath: 's3://bucket/manifest-2.avro',
          partitions: [
            {
              containsNull: false,
              lowerBound: new TextEncoder().encode('orders.do'),
              upperBound: new TextEncoder().encode('orders.do'),
            },
          ],
        },
      ]

      const filter: PartitionFilter = { ns: 'payments.do' }
      const filtered = filterManifestsByPartition(entries, filter, partitionSpec)

      expect(filtered.length).toBe(1)
      expect(filtered[0].manifestPath).toBe('s3://bucket/manifest-1.avro')
    })

    it('excludes manifests outside namespace bounds', () => {
      const entries: ManifestListEntry[] = [
        {
          ...sampleManifestListEntry,
          manifestPath: 's3://bucket/manifest-1.avro',
          partitions: [
            {
              containsNull: false,
              lowerBound: new TextEncoder().encode('aaa.do'),
              upperBound: new TextEncoder().encode('bbb.do'),
            },
          ],
        },
      ]

      const filter: PartitionFilter = { ns: 'zzz.do' }
      const filtered = filterManifestsByPartition(entries, filter, partitionSpec)

      expect(filtered.length).toBe(0)
    })
  })

  describe('filtering by type', () => {
    it('returns manifests containing the specified type', () => {
      const entries: ManifestListEntry[] = [
        {
          ...sampleManifestListEntry,
          manifestPath: 's3://bucket/manifest-functions.avro',
          partitions: [
            { containsNull: false },
            {
              containsNull: false,
              lowerBound: new TextEncoder().encode('Function'),
              upperBound: new TextEncoder().encode('Function'),
            },
          ],
        },
        {
          ...sampleManifestListEntry,
          manifestPath: 's3://bucket/manifest-events.avro',
          partitions: [
            { containsNull: false },
            {
              containsNull: false,
              lowerBound: new TextEncoder().encode('Event'),
              upperBound: new TextEncoder().encode('Event'),
            },
          ],
        },
      ]

      const filter: PartitionFilter = { type: 'Function' }
      const filtered = filterManifestsByPartition(entries, filter, partitionSpec)

      expect(filtered.length).toBe(1)
      expect(filtered[0].manifestPath).toBe('s3://bucket/manifest-functions.avro')
    })
  })

  describe('filtering by ns + type combined', () => {
    it('returns manifests matching both ns and type', () => {
      const entries: ManifestListEntry[] = [
        {
          ...sampleManifestListEntry,
          manifestPath: 's3://bucket/manifest-1.avro',
          partitions: [
            {
              containsNull: false,
              lowerBound: new TextEncoder().encode('payments.do'),
              upperBound: new TextEncoder().encode('payments.do'),
            },
            {
              containsNull: false,
              lowerBound: new TextEncoder().encode('Function'),
              upperBound: new TextEncoder().encode('Function'),
            },
          ],
        },
        {
          ...sampleManifestListEntry,
          manifestPath: 's3://bucket/manifest-2.avro',
          partitions: [
            {
              containsNull: false,
              lowerBound: new TextEncoder().encode('payments.do'),
              upperBound: new TextEncoder().encode('payments.do'),
            },
            {
              containsNull: false,
              lowerBound: new TextEncoder().encode('Event'),
              upperBound: new TextEncoder().encode('State'),
            },
          ],
        },
      ]

      const filter: PartitionFilter = { ns: 'payments.do', type: 'Function' }
      const filtered = filterManifestsByPartition(entries, filter, partitionSpec)

      expect(filtered.length).toBe(1)
      expect(filtered[0].manifestPath).toBe('s3://bucket/manifest-1.avro')
    })

    it('returns empty array when no manifests match both filters', () => {
      const entries: ManifestListEntry[] = [
        {
          ...sampleManifestListEntry,
          manifestPath: 's3://bucket/manifest-1.avro',
          partitions: [
            {
              containsNull: false,
              lowerBound: new TextEncoder().encode('orders.do'),
              upperBound: new TextEncoder().encode('orders.do'),
            },
            {
              containsNull: false,
              lowerBound: new TextEncoder().encode('Function'),
              upperBound: new TextEncoder().encode('Function'),
            },
          ],
        },
      ]

      const filter: PartitionFilter = { ns: 'payments.do', type: 'Function' }
      const filtered = filterManifestsByPartition(entries, filter, partitionSpec)

      expect(filtered.length).toBe(0)
    })
  })

  describe('edge cases', () => {
    it('includes manifests when partition summaries are missing', () => {
      // Conservative behavior: if we cant prune, include the manifest
      const entries: ManifestListEntry[] = [
        {
          ...sampleManifestListEntry,
          manifestPath: 's3://bucket/manifest-no-summaries.avro',
          partitions: undefined,
        },
      ]

      const filter: PartitionFilter = { ns: 'payments.do' }
      const filtered = filterManifestsByPartition(entries, filter, partitionSpec)

      // Should include since we can't prove it doesn't contain the partition
      expect(filtered.length).toBe(1)
    })

    it('handles empty filter (returns all manifests)', () => {
      const entries: ManifestListEntry[] = [
        { ...sampleManifestListEntry, manifestPath: 's3://bucket/manifest-1.avro' },
        { ...sampleManifestListEntry, manifestPath: 's3://bucket/manifest-2.avro' },
      ]

      const filter: PartitionFilter = {}
      const filtered = filterManifestsByPartition(entries, filter, partitionSpec)

      expect(filtered.length).toBe(2)
    })

    it('handles manifests with null partition values', () => {
      const entries: ManifestListEntry[] = [
        {
          ...sampleManifestListEntry,
          manifestPath: 's3://bucket/manifest-with-nulls.avro',
          partitions: [
            {
              containsNull: true,
              lowerBound: new TextEncoder().encode('payments.do'),
              upperBound: new TextEncoder().encode('payments.do'),
            },
          ],
        },
      ]

      const filter: PartitionFilter = { ns: 'payments.do' }
      const filtered = filterManifestsByPartition(entries, filter, partitionSpec)

      // Should still match since it contains the value (and also nulls)
      expect(filtered.length).toBe(1)
    })
  })
})

describe('filterDataFilesByPartition', () => {
  describe('filtering by exact partition match', () => {
    it('returns entries with matching ns partition', () => {
      const entries: ManifestEntry[] = [
        {
          ...sampleManifestEntry,
          dataFile: { ...sampleDataFile, partition: { ns: 'payments.do', type: 'Function' } },
        },
        {
          ...sampleManifestEntry,
          dataFile: { ...sampleDataFile, partition: { ns: 'orders.do', type: 'Function' } },
        },
      ]

      const filter: PartitionFilter = { ns: 'payments.do' }
      const filtered = filterDataFilesByPartition(entries, filter)

      expect(filtered.length).toBe(1)
      expect(filtered[0].dataFile.partition.ns).toBe('payments.do')
    })

    it('returns entries with matching type partition', () => {
      const entries: ManifestEntry[] = [
        {
          ...sampleManifestEntry,
          dataFile: { ...sampleDataFile, partition: { ns: 'payments.do', type: 'Function' } },
        },
        {
          ...sampleManifestEntry,
          dataFile: { ...sampleDataFile, partition: { ns: 'payments.do', type: 'Event' } },
        },
        {
          ...sampleManifestEntry,
          dataFile: { ...sampleDataFile, partition: { ns: 'payments.do', type: 'State' } },
        },
      ]

      const filter: PartitionFilter = { type: 'Function' }
      const filtered = filterDataFilesByPartition(entries, filter)

      expect(filtered.length).toBe(1)
      expect(filtered[0].dataFile.partition.type).toBe('Function')
    })

    it('returns entries matching both ns and type', () => {
      const entries: ManifestEntry[] = [
        {
          ...sampleManifestEntry,
          dataFile: {
            ...sampleDataFile,
            filePath: 's3://bucket/data/1.parquet',
            partition: { ns: 'payments.do', type: 'Function' },
          },
        },
        {
          ...sampleManifestEntry,
          dataFile: {
            ...sampleDataFile,
            filePath: 's3://bucket/data/2.parquet',
            partition: { ns: 'payments.do', type: 'Event' },
          },
        },
        {
          ...sampleManifestEntry,
          dataFile: {
            ...sampleDataFile,
            filePath: 's3://bucket/data/3.parquet',
            partition: { ns: 'orders.do', type: 'Function' },
          },
        },
      ]

      const filter: PartitionFilter = { ns: 'payments.do', type: 'Function' }
      const filtered = filterDataFilesByPartition(entries, filter)

      expect(filtered.length).toBe(1)
      expect(filtered[0].dataFile.filePath).toBe('s3://bucket/data/1.parquet')
    })
  })

  describe('edge cases', () => {
    it('returns all entries when filter is empty', () => {
      const entries: ManifestEntry[] = [
        {
          ...sampleManifestEntry,
          dataFile: { ...sampleDataFile, partition: { ns: 'payments.do', type: 'Function' } },
        },
        {
          ...sampleManifestEntry,
          dataFile: { ...sampleDataFile, partition: { ns: 'orders.do', type: 'Event' } },
        },
      ]

      const filter: PartitionFilter = {}
      const filtered = filterDataFilesByPartition(entries, filter)

      expect(filtered.length).toBe(2)
    })

    it('returns empty array when no entries match', () => {
      const entries: ManifestEntry[] = [
        {
          ...sampleManifestEntry,
          dataFile: { ...sampleDataFile, partition: { ns: 'orders.do', type: 'Event' } },
        },
      ]

      const filter: PartitionFilter = { ns: 'payments.do', type: 'Function' }
      const filtered = filterDataFilesByPartition(entries, filter)

      expect(filtered.length).toBe(0)
    })

    it('excludes deleted entries by default', () => {
      const entries: ManifestEntry[] = [
        {
          status: 1, // ADDED
          snapshotId: 1,
          dataFile: {
            ...sampleDataFile,
            filePath: 's3://bucket/data/added.parquet',
            partition: { ns: 'payments.do', type: 'Function' },
          },
        },
        {
          status: 2, // DELETED
          snapshotId: 1,
          dataFile: {
            ...sampleDataFile,
            filePath: 's3://bucket/data/deleted.parquet',
            partition: { ns: 'payments.do', type: 'Function' },
          },
        },
      ]

      const filter: PartitionFilter = { ns: 'payments.do', type: 'Function' }
      const filtered = filterDataFilesByPartition(entries, filter)

      // Should only return non-deleted entries
      expect(filtered.length).toBe(1)
      expect(filtered[0].dataFile.filePath).toBe('s3://bucket/data/added.parquet')
    })
  })
})

// ============================================================================
// Convenience Function Tests
// ============================================================================

describe('getManifestPaths', () => {
  it('extracts manifest paths from entries', () => {
    const entries: ManifestListEntry[] = [
      { ...sampleManifestListEntry, manifestPath: 's3://bucket/manifest-1.avro' },
      { ...sampleManifestListEntry, manifestPath: 's3://bucket/manifest-2.avro' },
      { ...sampleManifestListEntry, manifestPath: 's3://bucket/manifest-3.avro' },
    ]

    const paths = getManifestPaths(entries)

    expect(paths).toEqual([
      's3://bucket/manifest-1.avro',
      's3://bucket/manifest-2.avro',
      's3://bucket/manifest-3.avro',
    ])
  })

  it('returns empty array for empty input', () => {
    const paths = getManifestPaths([])
    expect(paths).toEqual([])
  })
})

describe('getDataFilePaths', () => {
  it('extracts data file paths from entries', () => {
    const entries: ManifestEntry[] = [
      {
        ...sampleManifestEntry,
        dataFile: { ...sampleDataFile, filePath: 's3://bucket/data/1.parquet' },
      },
      {
        ...sampleManifestEntry,
        dataFile: { ...sampleDataFile, filePath: 's3://bucket/data/2.parquet' },
      },
    ]

    const paths = getDataFilePaths(entries)

    expect(paths).toEqual(['s3://bucket/data/1.parquet', 's3://bucket/data/2.parquet'])
  })

  it('returns empty array for empty input', () => {
    const paths = getDataFilePaths([])
    expect(paths).toEqual([])
  })
})

// ============================================================================
// Integration Scenario Tests
// ============================================================================

describe('integration scenarios', () => {
  describe('DO resource lookup flow', () => {
    it('can filter manifests then data files for payments.do Functions', () => {
      // This simulates the full navigation chain for finding Function resources
      // in the payments.do namespace

      const partitionSpec = { ns: 1000, type: 1001 }

      // Step 1: Filter manifest list by partition
      const manifestEntries: ManifestListEntry[] = [
        {
          ...sampleManifestListEntry,
          manifestPath: 's3://bucket/manifest-payments-functions.avro',
          partitions: [
            {
              containsNull: false,
              lowerBound: new TextEncoder().encode('payments.do'),
              upperBound: new TextEncoder().encode('payments.do'),
            },
            {
              containsNull: false,
              lowerBound: new TextEncoder().encode('Function'),
              upperBound: new TextEncoder().encode('Function'),
            },
          ],
        },
        {
          ...sampleManifestListEntry,
          manifestPath: 's3://bucket/manifest-orders-events.avro',
          partitions: [
            {
              containsNull: false,
              lowerBound: new TextEncoder().encode('orders.do'),
              upperBound: new TextEncoder().encode('orders.do'),
            },
            {
              containsNull: false,
              lowerBound: new TextEncoder().encode('Event'),
              upperBound: new TextEncoder().encode('Event'),
            },
          ],
        },
      ]

      const partitionFilter: PartitionFilter = { ns: 'payments.do', type: 'Function' }
      const filteredManifests = filterManifestsByPartition(manifestEntries, partitionFilter, partitionSpec)

      expect(filteredManifests.length).toBe(1)
      expect(filteredManifests[0].manifestPath).toBe('s3://bucket/manifest-payments-functions.avro')

      // Step 2: Get manifest paths to fetch
      const manifestPaths = getManifestPaths(filteredManifests)
      expect(manifestPaths).toEqual(['s3://bucket/manifest-payments-functions.avro'])

      // Step 3: After fetching and parsing manifest, filter data files
      const dataFileEntries: ManifestEntry[] = [
        {
          status: 1,
          snapshotId: 123,
          dataFile: {
            ...sampleDataFile,
            filePath: 's3://bucket/data/payments-functions-1.parquet',
            partition: { ns: 'payments.do', type: 'Function' },
          },
        },
        {
          status: 1,
          snapshotId: 123,
          dataFile: {
            ...sampleDataFile,
            filePath: 's3://bucket/data/payments-functions-2.parquet',
            partition: { ns: 'payments.do', type: 'Function' },
          },
        },
      ]

      const filteredDataFiles = filterDataFilesByPartition(dataFileEntries, partitionFilter)
      expect(filteredDataFiles.length).toBe(2)

      // Step 4: Get data file paths
      const dataFilePaths = getDataFilePaths(filteredDataFiles)
      expect(dataFilePaths).toEqual([
        's3://bucket/data/payments-functions-1.parquet',
        's3://bucket/data/payments-functions-2.parquet',
      ])
    })
  })

  describe('event history retrieval', () => {
    it('can find Event data files for a specific DO namespace', () => {
      const partitionSpec = { ns: 1000, type: 1001 }

      const manifestEntries: ManifestListEntry[] = [
        {
          ...sampleManifestListEntry,
          manifestPath: 's3://bucket/manifest-events.avro',
          partitions: [
            {
              containsNull: false,
              lowerBound: new TextEncoder().encode('cart.do'),
              upperBound: new TextEncoder().encode('cart.do'),
            },
            {
              containsNull: false,
              lowerBound: new TextEncoder().encode('Event'),
              upperBound: new TextEncoder().encode('Event'),
            },
          ],
        },
      ]

      const filter: PartitionFilter = { ns: 'cart.do', type: 'Event' }
      const filtered = filterManifestsByPartition(manifestEntries, filter, partitionSpec)

      expect(filtered.length).toBe(1)
    })
  })
})
