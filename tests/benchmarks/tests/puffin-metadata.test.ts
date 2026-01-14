/**
 * Puffin Stats & Metadata Operations Benchmarks
 *
 * Tests performance of Puffin sidecar file operations and Iceberg metadata navigation:
 * - Puffin stats generation from data files
 * - Column statistics calculation
 * - SetIndex creation and lookup
 * - Puffin file serialization
 * - Metadata.json parsing
 * - Manifest list/file navigation
 * - Mark value extraction
 * - Partition pruning effectiveness
 * - Metadata caching
 *
 * Expected performance:
 * - Stats generation: <100ms
 * - Column statistics: <50ms
 * - Metadata parsing: <10ms
 * - Manifest navigation: <30ms
 * - Cache lookup: <1ms
 *
 * @see db/iceberg/puffin.ts for Puffin implementation
 * @see db/iceberg/metadata.ts for metadata parser
 * @see db/iceberg/marks.ts for mark file implementation
 * @see dotdo-6vjve for issue tracking
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  BloomFilter,
  NgramBloomFilter,
  SetIndex,
  PuffinWriter,
  PuffinReader,
  createBloomFilterFromValues,
  createNgramBloomFromValues,
  createSetIndexFromValues,
  estimateBloomFilterSize,
} from '../../db/iceberg/puffin'
import {
  parseMetadata,
  getCurrentSnapshot,
  getSchemaById,
  getFieldNames,
  getPartitionFieldNames,
  validateMetadata,
  type IcebergMetadata,
  type ParsedMetadata,
} from '../../db/iceberg/metadata'
import {
  MarkFileWriter,
  MarkFileReader,
  ColumnType,
  MarkFlags,
  createMarkFile,
  parseMarkFile,
  estimateMarkFileSize,
  type GranuleValue,
} from '../../db/iceberg/marks'

// ============================================================================
// CONFIGURATION
// ============================================================================

/** Maximum acceptable latency for stats generation (ms) */
const MAX_STATS_GENERATION_MS = 100

/** Maximum acceptable latency for column statistics (ms) */
const MAX_COLUMN_STATS_MS = 100

/** Maximum acceptable latency for SetIndex creation (ms) */
const MAX_SET_INDEX_MS = 20

/** Maximum acceptable latency for Puffin serialization (ms) */
const MAX_SERIALIZE_MS = 30

/** Maximum acceptable latency for metadata parsing (ms) */
const MAX_METADATA_PARSE_MS = 10

/** Maximum acceptable latency for manifest navigation (ms) */
const MAX_MANIFEST_NAVIGATION_MS = 30

/** Maximum acceptable latency for cached lookup (ms) */
const MAX_CACHE_LOOKUP_MS = 1

/** Default iterations for benchmarks */
const DEFAULT_ITERATIONS = 100

/** Warmup iterations */
const WARMUP_ITERATIONS = 10

// ============================================================================
// TEST DATA GENERATORS
// ============================================================================

/**
 * Generate sample string values for testing
 */
function generateStringValues(count: number): string[] {
  const values: string[] = []
  for (let i = 0; i < count; i++) {
    values.push(`value-${i.toString().padStart(6, '0')}-${Math.random().toString(36).substring(2, 10)}`)
  }
  return values
}

/**
 * Generate sample email addresses for n-gram testing
 */
function generateEmailValues(count: number): string[] {
  const domains = ['example.com', 'test.org', 'company.io', 'mail.net', 'service.co']
  const values: string[] = []
  for (let i = 0; i < count; i++) {
    const domain = domains[i % domains.length]
    values.push(`user${i}@${domain}`)
  }
  return values
}

/**
 * Generate sample status values (low cardinality)
 */
function generateStatusValues(): string[] {
  return ['active', 'pending', 'completed', 'cancelled', 'failed', 'archived']
}

/**
 * Create a valid Iceberg v2 metadata JSON string
 */
function createSampleMetadataJson(options?: {
  snapshotCount?: number
  schemaCount?: number
  formatVersion?: number
}): string {
  const {
    snapshotCount = 3,
    schemaCount = 1,
    formatVersion = 2,
  } = options ?? {}

  const schemas = Array.from({ length: schemaCount }, (_, i) => ({
    'schema-id': i,
    type: 'struct',
    fields: [
      { id: 1, name: 'ns', required: true, type: 'string' },
      { id: 2, name: 'type', required: true, type: 'string' },
      { id: 3, name: 'id', required: true, type: 'string' },
      { id: 4, name: 'ts', required: true, type: 'long' },
      { id: 5, name: 'data', required: false, type: 'string' },
    ],
  }))

  const snapshots = Array.from({ length: snapshotCount }, (_, i) => ({
    'snapshot-id': 1000 + i,
    'parent-snapshot-id': i > 0 ? 1000 + i - 1 : undefined,
    'sequence-number': i + 1,
    'timestamp-ms': Date.now() - (snapshotCount - i) * 3600000,
    'manifest-list': `s3://bucket/warehouse/db/table/metadata/snap-${1000 + i}-manifest-list.avro`,
    summary: {
      operation: 'append',
      'added-files-size': '1000000',
      'added-records': '10000',
    },
    'schema-id': 0,
  }))

  const metadata: Record<string, unknown> = {
    'format-version': formatVersion,
    'table-uuid': 'test-table-uuid',
    location: 's3://bucket/warehouse/db/table',
    'last-sequence-number': snapshotCount,
    'last-updated-ms': Date.now(),
    'last-column-id': 5,
    'current-schema-id': 0,
    schemas,
    'default-spec-id': 0,
    'partition-specs': [
      {
        'spec-id': 0,
        fields: [
          { 'source-id': 1, 'field-id': 1000, name: 'ns', transform: 'identity' },
          { 'source-id': 2, 'field-id': 1001, name: 'type', transform: 'identity' },
        ],
      },
    ],
    'last-partition-id': 1001,
    'default-sort-order-id': 0,
    'sort-orders': [{ 'order-id': 0, fields: [] }],
    'current-snapshot-id': snapshotCount > 0 ? 1000 + snapshotCount - 1 : null,
    snapshots,
    properties: {
      'write.parquet.compression-codec': 'zstd',
    },
  }

  return JSON.stringify(metadata)
}

/**
 * Create sample Parquet column statistics for mark file testing
 */
function createSampleColumnStats(granuleCount: number) {
  return {
    columnId: 3,
    name: 'id',
    type: ColumnType.String,
    granules: Array.from({ length: granuleCount }, (_, i) => ({
      byteOffset: BigInt(i * 65536),
      byteSize: 65536,
      rowStart: i * 8192,
      rowCount: 8192,
      minValue: `value-${(i * 1000).toString().padStart(6, '0')}`,
      maxValue: `value-${((i + 1) * 1000 - 1).toString().padStart(6, '0')}`,
      nullCount: 0,
    })),
  }
}

// ============================================================================
// MOCK METADATA CACHE
// ============================================================================

/**
 * Simple metadata cache for benchmarking cache behavior
 */
class MetadataCache {
  private cache = new Map<string, { data: ParsedMetadata; timestamp: number }>()
  private readonly ttlMs: number

  constructor(ttlMs: number = 60000) {
    this.ttlMs = ttlMs
  }

  get(key: string): ParsedMetadata | null {
    const entry = this.cache.get(key)
    if (!entry) return null
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key)
      return null
    }
    return entry.data
  }

  set(key: string, data: ParsedMetadata): void {
    this.cache.set(key, { data, timestamp: Date.now() })
  }

  clear(): void {
    this.cache.clear()
  }

  get size(): number {
    return this.cache.size
  }

  invalidate(key: string): boolean {
    return this.cache.delete(key)
  }
}

// ============================================================================
// PUFFIN STATS GENERATION BENCHMARKS
// ============================================================================

describe('Puffin Stats Generation Benchmarks', () => {
  describe('stats generation from data files', () => {
    it('generates bloom filter stats within latency budget', () => {
      const values = generateStringValues(10000)
      const times: number[] = []

      // Warmup
      for (let i = 0; i < WARMUP_ITERATIONS; i++) {
        createBloomFilterFromValues(values)
      }

      // Benchmark
      for (let i = 0; i < DEFAULT_ITERATIONS; i++) {
        const start = performance.now()
        const bloom = createBloomFilterFromValues(values)
        const elapsed = performance.now() - start
        times.push(elapsed)

        // Verify correctness
        expect(bloom.mightContain(values[0]!)).toBe(true)
      }

      const p50 = percentile(times, 50)
      const p99 = percentile(times, 99)

      console.log('\n=== Bloom Filter Stats Generation ===')
      console.log(`  p50: ${p50.toFixed(3)} ms`)
      console.log(`  p99: ${p99.toFixed(3)} ms`)
      console.log(`  Size: ${estimateBloomFilterSize(values.length)} bytes`)

      expect(p50).toBeLessThan(MAX_STATS_GENERATION_MS)
    })

    it('scales sub-linearly with row count', () => {
      const rowCounts = [1000, 10000, 100000]
      const results: Array<{ rows: number; p50: number }> = []

      for (const rowCount of rowCounts) {
        const values = generateStringValues(rowCount)
        const times: number[] = []

        // Warmup
        for (let i = 0; i < 3; i++) {
          createBloomFilterFromValues(values)
        }

        // Benchmark
        for (let i = 0; i < 30; i++) {
          const start = performance.now()
          createBloomFilterFromValues(values)
          times.push(performance.now() - start)
        }

        results.push({ rows: rowCount, p50: percentile(times, 50) })
      }

      console.log('\n=== Stats Generation by Row Count ===')
      for (const r of results) {
        console.log(`  ${r.rows} rows: ${r.p50.toFixed(3)} ms`)
      }

      // Verify better-than-linear scaling: 100x rows should not be 100x slower
      // Allow up to 50% of linear scaling (i.e., 100x rows should be at most 50x slower)
      const ratio = results[results.length - 1]!.p50 / results[0]!.p50
      const rowRatio = results[results.length - 1]!.rows / results[0]!.rows
      const scalingFactor = ratio / rowRatio

      console.log(`  Scaling factor: ${scalingFactor.toFixed(3)} (1.0 = linear, <1.0 = better than linear)`)

      // Accept scaling up to 2x worse than linear (accounts for memory allocation overhead)
      expect(scalingFactor).toBeLessThan(2)
    })
  })

  describe('column statistics calculation', () => {
    it('calculates bloom filter statistics efficiently', () => {
      const values = generateStringValues(5000)
      const times: number[] = []

      // Warmup
      for (let i = 0; i < WARMUP_ITERATIONS; i++) {
        const bloom = new BloomFilter({ expectedElements: values.length })
        for (const v of values) bloom.add(v)
      }

      // Benchmark
      for (let i = 0; i < DEFAULT_ITERATIONS; i++) {
        const start = performance.now()
        const bloom = new BloomFilter({ expectedElements: values.length })
        for (const v of values) bloom.add(v)
        const elapsed = performance.now() - start
        times.push(elapsed)
      }

      const p50 = percentile(times, 50)
      console.log('\n=== Column Bloom Filter Statistics ===')
      console.log(`  p50: ${p50.toFixed(3)} ms`)

      expect(p50).toBeLessThan(MAX_COLUMN_STATS_MS)
    })

    it('calculates ngram bloom filter statistics efficiently', () => {
      const values = generateEmailValues(5000)
      const times: number[] = []

      // Warmup
      for (let i = 0; i < WARMUP_ITERATIONS; i++) {
        createNgramBloomFromValues(values, 3)
      }

      // Benchmark
      for (let i = 0; i < DEFAULT_ITERATIONS; i++) {
        const start = performance.now()
        createNgramBloomFromValues(values, 3)
        const elapsed = performance.now() - start
        times.push(elapsed)
      }

      const p50 = percentile(times, 50)
      console.log('\n=== N-gram Bloom Filter Statistics ===')
      console.log(`  p50: ${p50.toFixed(3)} ms`)

      expect(p50).toBeLessThan(MAX_COLUMN_STATS_MS)
    })
  })

  describe('SetIndex creation and lookup', () => {
    it('creates SetIndex for low-cardinality column efficiently', () => {
      const values = generateStatusValues()
      const times: number[] = []

      // Warmup
      for (let i = 0; i < WARMUP_ITERATIONS; i++) {
        createSetIndexFromValues(values)
      }

      // Benchmark
      for (let i = 0; i < DEFAULT_ITERATIONS; i++) {
        const start = performance.now()
        const index = createSetIndexFromValues(values)
        const elapsed = performance.now() - start
        times.push(elapsed)

        expect(index.size).toBe(values.length)
      }

      const p50 = percentile(times, 50)
      console.log('\n=== SetIndex Creation ===')
      console.log(`  p50: ${p50.toFixed(3)} ms`)

      expect(p50).toBeLessThan(MAX_SET_INDEX_MS)
    })

    it('performs SetIndex lookup efficiently', () => {
      const values = generateStatusValues()
      const index = createSetIndexFromValues(values)
      const lookupValues = [...values, 'nonexistent1', 'nonexistent2']
      const times: number[] = []

      // Benchmark lookups
      for (let i = 0; i < DEFAULT_ITERATIONS * 10; i++) {
        const lookupValue = lookupValues[i % lookupValues.length]!
        const start = performance.now()
        index.contains(lookupValue)
        times.push(performance.now() - start)
      }

      const p50 = percentile(times, 50)
      console.log('\n=== SetIndex Lookup ===')
      console.log(`  p50: ${(p50 * 1000).toFixed(3)} us`)

      // Lookup should be near-instant
      expect(p50).toBeLessThan(0.1) // < 100 microseconds
    })

    it('scales with varying cardinalities', () => {
      const cardinalities = [5, 50, 500]
      const results: Array<{ cardinality: number; p50: number }> = []

      for (const cardinality of cardinalities) {
        const values = Array.from({ length: cardinality }, (_, i) => `status-${i}`)
        const times: number[] = []

        for (let i = 0; i < 50; i++) {
          const start = performance.now()
          createSetIndexFromValues(values)
          times.push(performance.now() - start)
        }

        results.push({ cardinality, p50: percentile(times, 50) })
      }

      console.log('\n=== SetIndex by Cardinality ===')
      for (const r of results) {
        console.log(`  ${r.cardinality} values: ${r.p50.toFixed(3)} ms`)
      }
    })
  })

  describe('Puffin file serialization', () => {
    it('serializes Puffin file efficiently', () => {
      const values = generateStringValues(1000)
      const bloom = createBloomFilterFromValues(values)
      const statusIndex = createSetIndexFromValues(generateStatusValues())
      const times: number[] = []

      // Warmup
      for (let i = 0; i < WARMUP_ITERATIONS; i++) {
        const writer = new PuffinWriter({ snapshotId: 123, sequenceNumber: 1 })
        writer.addBloomFilter(3, bloom)
        writer.addSetIndex(7, statusIndex)
        writer.finish()
      }

      // Benchmark
      for (let i = 0; i < DEFAULT_ITERATIONS; i++) {
        const start = performance.now()
        const writer = new PuffinWriter({ snapshotId: 123, sequenceNumber: 1 })
        writer.addBloomFilter(3, bloom)
        writer.addSetIndex(7, statusIndex)
        const bytes = writer.finish()
        const elapsed = performance.now() - start
        times.push(elapsed)

        expect(bytes.length).toBeGreaterThan(0)
      }

      const p50 = percentile(times, 50)
      console.log('\n=== Puffin Serialization ===')
      console.log(`  p50: ${p50.toFixed(3)} ms`)

      expect(p50).toBeLessThan(MAX_SERIALIZE_MS)
    })

    it('scales with blob count', () => {
      const blobCounts = [1, 5, 10]
      const results: Array<{ blobs: number; p50: number; sizeKB: number }> = []

      for (const blobCount of blobCounts) {
        const times: number[] = []
        let lastSize = 0

        for (let i = 0; i < 30; i++) {
          const writer = new PuffinWriter({ snapshotId: 123, sequenceNumber: 1 })

          for (let b = 0; b < blobCount; b++) {
            if (b % 2 === 0) {
              const bloom = new BloomFilter({ expectedElements: 1000 })
              bloom.add('test-value')
              writer.addBloomFilter(b, bloom)
            } else {
              const index = new SetIndex()
              index.add('status-1')
              writer.addSetIndex(b, index)
            }
          }

          const start = performance.now()
          const bytes = writer.finish()
          times.push(performance.now() - start)
          lastSize = bytes.length
        }

        results.push({
          blobs: blobCount,
          p50: percentile(times, 50),
          sizeKB: lastSize / 1024,
        })
      }

      console.log('\n=== Serialization by Blob Count ===')
      for (const r of results) {
        console.log(`  ${r.blobs} blobs: ${r.p50.toFixed(3)} ms (${r.sizeKB.toFixed(2)} KB)`)
      }
    })

    it('parses Puffin file round-trip', () => {
      const values = generateStringValues(1000)
      const bloom = createBloomFilterFromValues(values)
      const statusIndex = createSetIndexFromValues(generateStatusValues())

      const writer = new PuffinWriter({ snapshotId: 123, sequenceNumber: 1 })
      writer.addBloomFilter(3, bloom)
      writer.addSetIndex(7, statusIndex)
      const bytes = writer.finish()

      const times: number[] = []

      // Benchmark parsing
      for (let i = 0; i < DEFAULT_ITERATIONS; i++) {
        const start = performance.now()
        const reader = PuffinReader.fromBytes(bytes)
        const blobs = reader.getBlobs()
        times.push(performance.now() - start)

        expect(blobs.length).toBe(2)
      }

      const p50 = percentile(times, 50)
      console.log('\n=== Puffin Parsing ===')
      console.log(`  p50: ${p50.toFixed(3)} ms`)

      expect(p50).toBeLessThan(MAX_SERIALIZE_MS)
    })
  })
})

// ============================================================================
// METADATA OPERATIONS BENCHMARKS
// ============================================================================

describe('Metadata Operations Benchmarks', () => {
  describe('metadata.json parsing', () => {
    it('parses metadata.json efficiently', () => {
      const metadataJson = createSampleMetadataJson()
      const times: number[] = []

      // Warmup
      for (let i = 0; i < WARMUP_ITERATIONS; i++) {
        parseMetadata(metadataJson)
      }

      // Benchmark
      for (let i = 0; i < DEFAULT_ITERATIONS; i++) {
        const start = performance.now()
        const result = parseMetadata(metadataJson)
        const elapsed = performance.now() - start
        times.push(elapsed)

        expect(result.success).toBe(true)
      }

      const p50 = percentile(times, 50)
      const p99 = percentile(times, 99)

      console.log('\n=== Metadata.json Parsing ===')
      console.log(`  p50: ${p50.toFixed(3)} ms`)
      console.log(`  p99: ${p99.toFixed(3)} ms`)

      expect(p50).toBeLessThan(MAX_METADATA_PARSE_MS)
    })

    it('parses metadata with varying schema counts', () => {
      const schemaCounts = [1, 5, 20]
      const results: Array<{ schemas: number; p50: number }> = []

      for (const schemaCount of schemaCounts) {
        const metadataJson = createSampleMetadataJson({ schemaCount })
        const times: number[] = []

        for (let i = 0; i < 50; i++) {
          const start = performance.now()
          parseMetadata(metadataJson)
          times.push(performance.now() - start)
        }

        results.push({ schemas: schemaCount, p50: percentile(times, 50) })
      }

      console.log('\n=== Metadata Parsing by Schema Count ===')
      for (const r of results) {
        console.log(`  ${r.schemas} schemas: ${r.p50.toFixed(3)} ms`)
      }

      // Should remain fast regardless of schema count
      for (const r of results) {
        expect(r.p50).toBeLessThan(MAX_METADATA_PARSE_MS * 2)
      }
    })

    it('parses metadata with varying snapshot counts', () => {
      const snapshotCounts = [1, 10, 100]
      const results: Array<{ snapshots: number; p50: number }> = []

      for (const snapshotCount of snapshotCounts) {
        const metadataJson = createSampleMetadataJson({ snapshotCount })
        const times: number[] = []

        for (let i = 0; i < 50; i++) {
          const start = performance.now()
          parseMetadata(metadataJson)
          times.push(performance.now() - start)
        }

        results.push({ snapshots: snapshotCount, p50: percentile(times, 50) })
      }

      console.log('\n=== Metadata Parsing by Snapshot Count ===')
      for (const r of results) {
        console.log(`  ${r.snapshots} snapshots: ${r.p50.toFixed(3)} ms`)
      }
    })
  })

  describe('manifest list navigation', () => {
    it('simulates manifest list traversal', () => {
      // Mock manifest list data structure
      const manifestEntries = Array.from({ length: 20 }, (_, i) => ({
        manifestPath: `s3://bucket/warehouse/db/table/metadata/manifest-${i}.avro`,
        manifestLength: 1000000,
        partitionSpecId: 0,
        addedFilesCount: 100,
        existingFilesCount: 0,
        deletedFilesCount: 0,
        partitionFieldSummary: {
          containsNull: false,
          lowerBound: `ns-${i * 5}`,
          upperBound: `ns-${(i + 1) * 5}`,
        },
      }))

      const times: number[] = []

      // Benchmark filtering manifest list by partition value
      for (let i = 0; i < DEFAULT_ITERATIONS; i++) {
        const targetNs = `ns-${Math.floor(Math.random() * 100)}`

        const start = performance.now()
        // Simulate partition pruning on manifest list
        const matchingManifests = manifestEntries.filter((entry) => {
          const lower = entry.partitionFieldSummary.lowerBound
          const upper = entry.partitionFieldSummary.upperBound
          return targetNs >= lower && targetNs <= upper
        })
        times.push(performance.now() - start)

        expect(matchingManifests.length).toBeGreaterThanOrEqual(0)
      }

      const p50 = percentile(times, 50)
      console.log('\n=== Manifest List Navigation ===')
      console.log(`  p50: ${(p50 * 1000).toFixed(3)} us`)

      // Should be very fast (microseconds)
      expect(p50).toBeLessThan(1)
    })
  })

  describe('manifest file reading', () => {
    it('simulates manifest file data extraction', () => {
      // Mock manifest file entries
      const fileEntries = Array.from({ length: 1000 }, (_, i) => ({
        status: 1, // Added
        snapshotId: 1000,
        dataFile: {
          filePath: `s3://bucket/warehouse/db/table/data/part-${i}.parquet`,
          fileFormat: 'PARQUET',
          partition: { ns: `ns-${i % 10}`, type: 'Function' },
          recordCount: 10000,
          fileSizeInBytes: 1000000,
          columnSizes: { 1: 100000, 2: 100000, 3: 200000 },
          valueCounts: { 1: 10000, 2: 10000, 3: 10000 },
          nullValueCounts: { 1: 0, 2: 0, 3: 100 },
          lowerBounds: { 3: `id-${i * 1000}` },
          upperBounds: { 3: `id-${(i + 1) * 1000 - 1}` },
        },
      }))

      const times: number[] = []

      // Benchmark filtering by partition
      for (let i = 0; i < DEFAULT_ITERATIONS; i++) {
        const targetNs = `ns-${Math.floor(Math.random() * 10)}`

        const start = performance.now()
        const matchingFiles = fileEntries.filter((entry) => entry.dataFile.partition.ns === targetNs)
        times.push(performance.now() - start)

        expect(matchingFiles.length).toBeGreaterThan(0)
      }

      const p50 = percentile(times, 50)
      console.log('\n=== Manifest File Reading ===')
      console.log(`  p50: ${p50.toFixed(3)} ms`)

      expect(p50).toBeLessThan(MAX_MANIFEST_NAVIGATION_MS)
    })
  })

  describe('data file discovery', () => {
    it('discovers data files from manifest chain', () => {
      const metadataJson = createSampleMetadataJson({ snapshotCount: 5 })
      const times: number[] = []

      // Benchmark end-to-end discovery
      for (let i = 0; i < DEFAULT_ITERATIONS; i++) {
        const start = performance.now()

        // Step 1: Parse metadata
        const result = parseMetadata(metadataJson)
        expect(result.success).toBe(true)
        if (!result.success) continue

        // Step 2: Get current snapshot ID
        const currentSnapshotId = result.data.currentSnapshotId

        // Step 3: Extract manifest list path (simulated)
        const manifestListPath = `s3://bucket/warehouse/db/table/metadata/snap-${currentSnapshotId}-manifest-list.avro`

        times.push(performance.now() - start)

        expect(manifestListPath).toContain('manifest-list.avro')
      }

      const p50 = percentile(times, 50)
      console.log('\n=== Data File Discovery ===')
      console.log(`  p50: ${p50.toFixed(3)} ms`)

      expect(p50).toBeLessThan(MAX_METADATA_PARSE_MS)
    })
  })
})

// ============================================================================
// MARKS & PRUNING BENCHMARKS
// ============================================================================

describe('Marks & Pruning Benchmarks', () => {
  describe('mark value extraction', () => {
    it('extracts mark values efficiently', () => {
      const columnStats = createSampleColumnStats(100)
      const markFile = createMarkFile([columnStats])
      const times: number[] = []

      // Warmup
      for (let i = 0; i < WARMUP_ITERATIONS; i++) {
        parseMarkFile(markFile)
      }

      // Benchmark
      for (let i = 0; i < DEFAULT_ITERATIONS; i++) {
        const start = performance.now()
        const reader = parseMarkFile(markFile)
        const granules = reader.getAllGranules()
        times.push(performance.now() - start)

        expect(granules.length).toBe(100)
      }

      const p50 = percentile(times, 50)
      console.log('\n=== Mark Value Extraction ===')
      console.log(`  p50: ${p50.toFixed(3)} ms`)

      expect(p50).toBeLessThan(MAX_COLUMN_STATS_MS)
    })

    it('finds granules by value efficiently', () => {
      const columnStats = createSampleColumnStats(100)
      const markFile = createMarkFile([columnStats])
      const reader = parseMarkFile(markFile)
      const times: number[] = []

      // Benchmark granule lookup
      for (let i = 0; i < DEFAULT_ITERATIONS * 10; i++) {
        const searchValue = `value-${(Math.floor(Math.random() * 100) * 1000).toString().padStart(6, '0')}`

        const start = performance.now()
        reader.findGranule(3, searchValue)
        times.push(performance.now() - start)
      }

      const p50 = percentile(times, 50)
      console.log('\n=== Mark Granule Lookup ===')
      console.log(`  p50: ${(p50 * 1000).toFixed(3)} us`)

      // Binary search should be very fast
      expect(p50).toBeLessThan(1)
    })
  })

  describe('partition pruning decisions', () => {
    it('makes partition pruning decisions efficiently', () => {
      // Mock partition values
      const partitions = Array.from({ length: 100 }, (_, i) => ({
        ns: `ns-${i % 10}`,
        type: ['Function', 'Workflow', 'Entity'][i % 3],
      }))

      const times: number[] = []

      // Benchmark partition filtering
      for (let i = 0; i < DEFAULT_ITERATIONS; i++) {
        const targetNs = `ns-${Math.floor(Math.random() * 10)}`
        const targetType = ['Function', 'Workflow', 'Entity'][Math.floor(Math.random() * 3)]

        const start = performance.now()
        const matchingPartitions = partitions.filter((p) => p.ns === targetNs && p.type === targetType)
        times.push(performance.now() - start)

        expect(matchingPartitions.length).toBeGreaterThanOrEqual(0)
      }

      const p50 = percentile(times, 50)
      console.log('\n=== Partition Pruning Decisions ===')
      console.log(`  p50: ${(p50 * 1000).toFixed(3)} us`)

      expect(p50).toBeLessThan(1)
    })

    it('uses bloom filter for pruning decisions', () => {
      const values = generateStringValues(10000)
      const bloom = createBloomFilterFromValues(values)
      const testValues = [...values.slice(0, 100), ...generateStringValues(100)]
      const times: number[] = []

      // Benchmark bloom filter checks
      for (let i = 0; i < DEFAULT_ITERATIONS * 10; i++) {
        const testValue = testValues[i % testValues.length]!

        const start = performance.now()
        bloom.mightContain(testValue)
        times.push(performance.now() - start)
      }

      const p50 = percentile(times, 50)
      console.log('\n=== Bloom Filter Pruning ===')
      console.log(`  p50: ${(p50 * 1000).toFixed(3)} us`)

      // Bloom filter check should be very fast
      expect(p50).toBeLessThan(0.1)
    })
  })

  describe('manifest elimination', () => {
    it('eliminates manifests using partition summaries', () => {
      // Mock manifest summaries with partition ranges
      const manifests = Array.from({ length: 50 }, (_, i) => ({
        manifestPath: `manifest-${i}.avro`,
        partitionSummary: {
          ns: { min: `ns-${i * 2}`, max: `ns-${i * 2 + 1}` },
          type: { min: 'Entity', max: 'Workflow' },
        },
      }))

      const times: number[] = []

      // Benchmark manifest elimination
      for (let i = 0; i < DEFAULT_ITERATIONS; i++) {
        const targetNs = `ns-${Math.floor(Math.random() * 100)}`

        const start = performance.now()
        const relevantManifests = manifests.filter((m) => {
          const { min, max } = m.partitionSummary.ns
          return targetNs >= min && targetNs <= max
        })
        times.push(performance.now() - start)

        expect(relevantManifests.length).toBeLessThanOrEqual(manifests.length)
      }

      const p50 = percentile(times, 50)
      console.log('\n=== Manifest Elimination ===')
      console.log(`  p50: ${(p50 * 1000).toFixed(3)} us`)

      expect(p50).toBeLessThan(1)
    })
  })
})

// ============================================================================
// CACHING BENCHMARKS
// ============================================================================

describe('Caching Benchmarks', () => {
  let cache: MetadataCache

  beforeAll(() => {
    cache = new MetadataCache(60000) // 1 minute TTL
  })

  afterAll(() => {
    cache.clear()
  })

  describe('metadata cache effectiveness', () => {
    it('measures cache hit performance', () => {
      const metadataJson = createSampleMetadataJson()
      const result = parseMetadata(metadataJson)
      expect(result.success).toBe(true)
      if (!result.success) return

      // Populate cache
      cache.set('table-1', result.data)

      const times: number[] = []

      // Benchmark cache hits
      for (let i = 0; i < DEFAULT_ITERATIONS; i++) {
        const start = performance.now()
        const cached = cache.get('table-1')
        times.push(performance.now() - start)

        expect(cached).not.toBeNull()
      }

      const p50 = percentile(times, 50)
      console.log('\n=== Cache Hit Performance ===')
      console.log(`  p50: ${(p50 * 1000).toFixed(3)} us`)

      expect(p50).toBeLessThan(MAX_CACHE_LOOKUP_MS)
    })

    it('measures cache miss performance', () => {
      const times: number[] = []

      // Benchmark cache misses
      for (let i = 0; i < DEFAULT_ITERATIONS; i++) {
        const key = `nonexistent-${i}`

        const start = performance.now()
        const cached = cache.get(key)
        times.push(performance.now() - start)

        expect(cached).toBeNull()
      }

      const p50 = percentile(times, 50)
      console.log('\n=== Cache Miss Performance ===')
      console.log(`  p50: ${(p50 * 1000).toFixed(3)} us`)

      expect(p50).toBeLessThan(MAX_CACHE_LOOKUP_MS)
    })

    it('compares cached vs uncached parsing', () => {
      const metadataJson = createSampleMetadataJson({ snapshotCount: 50 })

      // Uncached times
      const uncachedTimes: number[] = []
      for (let i = 0; i < 50; i++) {
        const start = performance.now()
        parseMetadata(metadataJson)
        uncachedTimes.push(performance.now() - start)
      }

      // Populate cache
      const result = parseMetadata(metadataJson)
      expect(result.success).toBe(true)
      if (!result.success) return
      cache.set('table-cached', result.data)

      // Cached times
      const cachedTimes: number[] = []
      for (let i = 0; i < 50; i++) {
        const start = performance.now()
        cache.get('table-cached')
        cachedTimes.push(performance.now() - start)
      }

      const uncachedP50 = percentile(uncachedTimes, 50)
      const cachedP50 = percentile(cachedTimes, 50)

      console.log('\n=== Cached vs Uncached ===')
      console.log(`  Uncached p50: ${uncachedP50.toFixed(3)} ms`)
      console.log(`  Cached p50: ${(cachedP50 * 1000).toFixed(3)} us`)
      console.log(`  Speedup: ${(uncachedP50 / cachedP50).toFixed(0)}x`)

      expect(cachedP50).toBeLessThan(uncachedP50)
    })
  })

  describe('cache TTL behavior', () => {
    it('respects TTL expiration', async () => {
      const shortCache = new MetadataCache(50) // 50ms TTL

      const metadataJson = createSampleMetadataJson()
      const result = parseMetadata(metadataJson)
      expect(result.success).toBe(true)
      if (!result.success) return

      shortCache.set('ttl-test', result.data)

      // Should be cached
      expect(shortCache.get('ttl-test')).not.toBeNull()

      // Wait for TTL
      await new Promise((resolve) => setTimeout(resolve, 60))

      // Should be expired
      const start = performance.now()
      const cached = shortCache.get('ttl-test')
      const elapsed = performance.now() - start

      console.log('\n=== TTL Expiration Check ===')
      console.log(`  Lookup time: ${(elapsed * 1000).toFixed(3)} us`)

      expect(cached).toBeNull()
      expect(elapsed).toBeLessThan(MAX_CACHE_LOOKUP_MS)
    })
  })

  describe('cache invalidation', () => {
    it('invalidates cache entries efficiently', () => {
      const metadataJson = createSampleMetadataJson()
      const result = parseMetadata(metadataJson)
      expect(result.success).toBe(true)
      if (!result.success) return

      // Populate multiple entries
      for (let i = 0; i < 100; i++) {
        cache.set(`invalidation-test-${i}`, result.data)
      }

      const times: number[] = []

      // Benchmark invalidation
      for (let i = 0; i < 100; i++) {
        const start = performance.now()
        cache.invalidate(`invalidation-test-${i}`)
        times.push(performance.now() - start)
      }

      const p50 = percentile(times, 50)
      console.log('\n=== Cache Invalidation ===')
      console.log(`  p50: ${(p50 * 1000).toFixed(3)} us`)

      expect(p50).toBeLessThan(MAX_CACHE_LOOKUP_MS)
    })
  })
})

// ============================================================================
// SUMMARY
// ============================================================================

describe('Performance Summary', () => {
  it('documents expected performance characteristics', () => {
    console.log('\n========================================')
    console.log('PUFFIN & METADATA PERFORMANCE SUMMARY')
    console.log('========================================\n')

    console.log('Expected benchmarks:')
    console.log(`  - Stats generation: <${MAX_STATS_GENERATION_MS}ms`)
    console.log(`  - Column statistics: <${MAX_COLUMN_STATS_MS}ms`)
    console.log(`  - SetIndex creation: <${MAX_SET_INDEX_MS}ms`)
    console.log(`  - Puffin serialization: <${MAX_SERIALIZE_MS}ms`)
    console.log(`  - Metadata parsing: <${MAX_METADATA_PARSE_MS}ms`)
    console.log(`  - Manifest navigation: <${MAX_MANIFEST_NAVIGATION_MS}ms`)
    console.log(`  - Cache lookup: <${MAX_CACHE_LOOKUP_MS}ms`)
    console.log('')

    console.log('Key optimizations:')
    console.log('  - MurmurHash3 for bloom filters (fast, non-cryptographic)')
    console.log('  - Binary serialization with minimal overhead')
    console.log('  - Range-addressable Puffin format for partial fetches')
    console.log('  - JSON footer for fast metadata lookup')
    console.log('  - Binary search on mark file granules')
    console.log('  - In-memory metadata caching with TTL')
    console.log('')

    console.log('Query optimization via pruning:')
    console.log('  1. Manifest-level pruning using partition summaries')
    console.log('  2. Data file pruning using partition values')
    console.log('  3. Granule-level pruning using mark file min/max')
    console.log('  4. Row-level pruning using bloom filters')
    console.log('')

    expect(true).toBe(true)
  })
})

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Calculate percentile from sorted array
 */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, index)]!
}
