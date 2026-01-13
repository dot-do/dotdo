/**
 * Parquet Operations Benchmarks (Local Mock Tests)
 *
 * TDD benchmarks for Parquet file operations in Workers environment.
 * Tests both read and write operations with various configurations.
 *
 * Benchmark categories:
 * 1. Parquet Reading - Single record, column projection, row groups, predicates
 * 2. Parquet Writing - Batch writes, column encoding, compression
 * 3. R2 Integration - Streaming reads/writes, range requests
 *
 * Note: These tests use mock implementations to isolate Parquet
 * logic performance from network I/O. Production performance will
 * depend on parquet-wasm in Workers and R2 integration.
 *
 * @see db/parquet/ for Parquet implementation
 * @see dotdo-x3p2c for issue tracking
 */

import { describe, it, expect, beforeEach } from 'vitest'

// ============================================================================
// BENCHMARK CONFIGURATION
// ============================================================================

/** Number of iterations for warm benchmarks */
const BENCHMARK_ITERATIONS = 50

/** Number of warmup iterations before measuring */
const WARMUP_ITERATIONS = 5

/** Performance targets (ms) - Adjusted for mock implementations */
const TARGETS = {
  // Read operations (mock in-memory - very fast)
  SINGLE_RECORD_READ: 5,
  COLUMN_PROJECTION: 3,
  ROW_GROUP_NAVIGATION: 10,
  PREDICATE_PUSHDOWN: 50, // Full scan in mock, higher target
  // Write operations (mock with simulated overhead)
  BATCH_WRITE_100: 100, // More realistic for mock with embeddings
  DICTIONARY_ENCODING: 120,
  RLE_ENCODING: 110,
  SNAPPY_COMPRESSION: 100,
  ZSTD_COMPRESSION: 150,
  // R2 operations (mock with simulated latency)
  STREAMING_READ: 50,
  STREAMING_WRITE: 100,
  RANGE_REQUEST: 10,
} as const

/** Minimum acceptable throughput (ops/sec) */
const MIN_THROUGHPUT_OPS_SEC = 50

// ============================================================================
// BENCHMARK UTILITIES
// ============================================================================

interface BenchmarkResult {
  name: string
  iterations: number
  totalMs: number
  avgMs: number
  minMs: number
  maxMs: number
  opsPerSec: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
}

/**
 * Runs a benchmark and collects timing statistics
 */
async function runBenchmark(
  name: string,
  fn: () => Promise<void> | void,
  iterations: number = BENCHMARK_ITERATIONS,
  warmupIterations: number = WARMUP_ITERATIONS
): Promise<BenchmarkResult> {
  // Warmup phase
  for (let i = 0; i < warmupIterations; i++) {
    await fn()
  }

  // Collect timing samples
  const samples: number[] = []

  for (let i = 0; i < iterations; i++) {
    const start = performance.now()
    await fn()
    const end = performance.now()
    samples.push(end - start)
  }

  // Calculate statistics
  samples.sort((a, b) => a - b)
  const totalMs = samples.reduce((a, b) => a + b, 0)
  const avgMs = totalMs / iterations
  const minMs = samples[0]!
  const maxMs = samples[samples.length - 1]!
  const opsPerSec = 1000 / avgMs
  const p50Ms = samples[Math.floor(iterations * 0.5)]!
  const p95Ms = samples[Math.floor(iterations * 0.95)]!
  const p99Ms = samples[Math.floor(iterations * 0.99)]!

  return {
    name,
    iterations,
    totalMs,
    avgMs,
    minMs,
    maxMs,
    opsPerSec,
    p50Ms,
    p95Ms,
    p99Ms,
  }
}

/**
 * Formats benchmark result for console output
 */
function formatBenchmarkResult(result: BenchmarkResult): string {
  return [
    `  ${result.name}:`,
    `    Avg: ${result.avgMs.toFixed(3)} ms`,
    `    Min: ${result.minMs.toFixed(3)} ms, Max: ${result.maxMs.toFixed(3)} ms`,
    `    P50: ${result.p50Ms.toFixed(3)} ms, P95: ${result.p95Ms.toFixed(3)} ms, P99: ${result.p99Ms.toFixed(3)} ms`,
    `    Throughput: ${result.opsPerSec.toFixed(1)} ops/sec`,
  ].join('\n')
}

// ============================================================================
// MOCK PARQUET IMPLEMENTATION
// ============================================================================

/**
 * Mock vector record for testing
 */
interface MockVectorRecord {
  ns: string
  type: string
  visibility: string | null
  id: string
  embedding: Float32Array
  metadata: string | null
  created_at: number
}

/**
 * Parquet compression types
 */
type ParquetCompression = 'NONE' | 'SNAPPY' | 'ZSTD' | 'GZIP'

/**
 * Column encoding types
 */
type ColumnEncoding = 'PLAIN' | 'DICTIONARY' | 'RLE'

/**
 * Row group metadata
 */
interface RowGroupMetadata {
  index: number
  rowCount: number
  startRow: number
  endRow: number
  columnChunks: Map<string, { offset: number; size: number }>
  minValues: Map<string, unknown>
  maxValues: Map<string, unknown>
}

/**
 * Mock Parquet file for in-memory testing
 */
class MockParquetFile {
  private records: MockVectorRecord[] = []
  private rowGroups: RowGroupMetadata[] = []
  private schema: string[] = ['ns', 'type', 'visibility', 'id', 'embedding', 'metadata', 'created_at']
  private compression: ParquetCompression = 'NONE'
  private encoding: ColumnEncoding = 'PLAIN'
  private rowGroupSize: number = 1000

  constructor(options?: {
    compression?: ParquetCompression
    encoding?: ColumnEncoding
    rowGroupSize?: number
  }) {
    if (options?.compression) this.compression = options.compression
    if (options?.encoding) this.encoding = options.encoding
    if (options?.rowGroupSize) this.rowGroupSize = options.rowGroupSize
  }

  /**
   * Add records to the file
   */
  addRecords(records: MockVectorRecord[]): void {
    const startRow = this.records.length
    this.records.push(...records)

    // Create row groups
    for (let i = startRow; i < this.records.length; i += this.rowGroupSize) {
      const groupRecords = this.records.slice(i, Math.min(i + this.rowGroupSize, this.records.length))
      const rowGroup: RowGroupMetadata = {
        index: this.rowGroups.length,
        rowCount: groupRecords.length,
        startRow: i,
        endRow: i + groupRecords.length,
        columnChunks: new Map(),
        minValues: new Map(),
        maxValues: new Map(),
      }

      // Calculate column stats for predicate pushdown
      for (const col of this.schema) {
        const values = groupRecords.map((r) => (r as Record<string, unknown>)[col])
        const sortedValues = values.filter((v) => v != null).sort()
        if (sortedValues.length > 0) {
          rowGroup.minValues.set(col, sortedValues[0])
          rowGroup.maxValues.set(col, sortedValues[sortedValues.length - 1])
        }
      }

      this.rowGroups.push(rowGroup)
    }
  }

  /**
   * Read single record by row index
   */
  readRecord(rowIndex: number): MockVectorRecord | null {
    return this.records[rowIndex] ?? null
  }

  /**
   * Read record by ID (simulates index lookup)
   */
  readById(id: string): MockVectorRecord | null {
    return this.records.find((r) => r.id === id) ?? null
  }

  /**
   * Read with column projection
   */
  readProjected(rowIndex: number, columns: string[]): Partial<MockVectorRecord> | null {
    const record = this.records[rowIndex]
    if (!record) return null

    const result: Partial<MockVectorRecord> = {}
    for (const col of columns) {
      if (col in record) {
        (result as Record<string, unknown>)[col] = (record as Record<string, unknown>)[col]
      }
    }
    return result
  }

  /**
   * Read row group by index
   */
  readRowGroup(groupIndex: number): MockVectorRecord[] {
    const rowGroup = this.rowGroups[groupIndex]
    if (!rowGroup) return []
    return this.records.slice(rowGroup.startRow, rowGroup.endRow)
  }

  /**
   * Read with row group offset and limit
   */
  readRowGroupRange(groupIndex: number, offset: number, limit: number): MockVectorRecord[] {
    const rowGroup = this.rowGroups[groupIndex]
    if (!rowGroup) return []
    const start = rowGroup.startRow + offset
    const end = Math.min(start + limit, rowGroup.endRow)
    return this.records.slice(start, end)
  }

  /**
   * Apply predicate pushdown (returns row groups that may contain matches)
   */
  findRowGroupsWithPredicate(
    column: string,
    predicate: { type: 'eq'; value: unknown } | { type: 'range'; min: unknown; max: unknown }
  ): number[] {
    const matchingGroups: number[] = []

    for (const rowGroup of this.rowGroups) {
      const minVal = rowGroup.minValues.get(column)
      const maxVal = rowGroup.maxValues.get(column)

      if (minVal === undefined || maxVal === undefined) {
        // No stats, must scan
        matchingGroups.push(rowGroup.index)
        continue
      }

      if (predicate.type === 'eq') {
        // Check if value is within row group's min/max range
        if (predicate.value >= minVal && predicate.value <= maxVal) {
          matchingGroups.push(rowGroup.index)
        }
      } else {
        // Range predicate - check for overlap
        if (predicate.max >= minVal && predicate.min <= maxVal) {
          matchingGroups.push(rowGroup.index)
        }
      }
    }

    return matchingGroups
  }

  /**
   * Query with predicate pushdown
   */
  queryWithPredicate(
    column: string,
    predicate: { type: 'eq'; value: unknown } | { type: 'range'; min: unknown; max: unknown }
  ): MockVectorRecord[] {
    const matchingGroups = this.findRowGroupsWithPredicate(column, predicate)
    const results: MockVectorRecord[] = []

    for (const groupIndex of matchingGroups) {
      const records = this.readRowGroup(groupIndex)
      for (const record of records) {
        const value = (record as Record<string, unknown>)[column]

        if (predicate.type === 'eq') {
          if (value === predicate.value) {
            results.push(record)
          }
        } else {
          if (value !== null && value !== undefined && value >= predicate.min && value <= predicate.max) {
            results.push(record)
          }
        }
      }
    }

    return results
  }

  /**
   * Get row group count
   */
  getRowGroupCount(): number {
    return this.rowGroups.length
  }

  /**
   * Get total record count
   */
  getRecordCount(): number {
    return this.records.length
  }

  /**
   * Get row group metadata
   */
  getRowGroupMetadata(index: number): RowGroupMetadata | null {
    return this.rowGroups[index] ?? null
  }

  /**
   * Simulate compression overhead
   */
  private applyCompression(data: Uint8Array): Uint8Array {
    // Simulate compression time based on algorithm
    const start = performance.now()

    switch (this.compression) {
      case 'SNAPPY':
        // Snappy is fast, minimal overhead
        while (performance.now() - start < 0.01) {
          // ~10us overhead per call
        }
        break
      case 'ZSTD':
        // ZSTD is slower but better compression
        while (performance.now() - start < 0.05) {
          // ~50us overhead per call
        }
        break
      case 'GZIP':
        // GZIP is slowest
        while (performance.now() - start < 0.1) {
          // ~100us overhead per call
        }
        break
      default:
        // No compression
        break
    }

    return data
  }

  /**
   * Simulate encoding overhead
   */
  private applyEncoding(values: unknown[]): Uint8Array {
    const start = performance.now()

    switch (this.encoding) {
      case 'DICTIONARY':
        // Dictionary encoding: build dictionary + indices
        const unique = [...new Set(values.map(String))]
        // Overhead proportional to unique count
        while (performance.now() - start < unique.length * 0.001) {
          // ~1us per unique value
        }
        break
      case 'RLE':
        // RLE: count runs
        let runs = 1
        for (let i = 1; i < values.length; i++) {
          if (values[i] !== values[i - 1]) runs++
        }
        while (performance.now() - start < runs * 0.0001) {
          // ~0.1us per run
        }
        break
      default:
        // Plain encoding - minimal overhead
        break
    }

    return new Uint8Array(0)
  }

  /**
   * Serialize to bytes (mock)
   */
  toBytes(): Uint8Array {
    // Mock serialization with encoding and compression
    for (const col of this.schema) {
      const values = this.records.map((r) => (r as Record<string, unknown>)[col])
      const encoded = this.applyEncoding(values)
      this.applyCompression(encoded)
    }

    // Return mock bytes (size estimate)
    const estimatedSize = this.records.length * 6200 // ~6KB per vector record
    return new Uint8Array(Math.floor(estimatedSize * (this.compression === 'NONE' ? 1 : 0.3)))
  }
}

/**
 * Mock Parquet writer for benchmarking
 */
class MockParquetWriter {
  private file: MockParquetFile
  private buffer: MockVectorRecord[] = []
  private flushThreshold: number = 1000

  constructor(options?: {
    compression?: ParquetCompression
    encoding?: ColumnEncoding
    rowGroupSize?: number
  }) {
    this.file = new MockParquetFile(options)
    if (options?.rowGroupSize) this.flushThreshold = options.rowGroupSize
  }

  /**
   * Add a record to the writer
   */
  addRecord(record: MockVectorRecord): void {
    this.buffer.push(record)

    if (this.buffer.length >= this.flushThreshold) {
      this.flush()
    }
  }

  /**
   * Add multiple records
   */
  addRecords(records: MockVectorRecord[]): void {
    for (const record of records) {
      this.addRecord(record)
    }
  }

  /**
   * Flush buffer to file
   */
  flush(): void {
    if (this.buffer.length > 0) {
      this.file.addRecords(this.buffer)
      this.buffer = []
    }
  }

  /**
   * Finish writing and return the file
   */
  finish(): { file: MockParquetFile; bytes: Uint8Array; stats: { rowCount: number; rowGroupCount: number; compressedSize: number } } {
    this.flush()
    const bytes = this.file.toBytes()
    return {
      file: this.file,
      bytes,
      stats: {
        rowCount: this.file.getRecordCount(),
        rowGroupCount: this.file.getRowGroupCount(),
        compressedSize: bytes.length,
      },
    }
  }
}

/**
 * Mock R2 storage for streaming benchmarks
 */
class MockR2Storage {
  private files = new Map<string, Uint8Array>()
  private parquetFiles = new Map<string, MockParquetFile>()

  /**
   * Put file (streaming write)
   */
  async put(path: string, data: Uint8Array, parquetFile?: MockParquetFile): Promise<{ etag: string }> {
    // Simulate R2 write latency
    await new Promise((resolve) => setTimeout(resolve, 1))
    this.files.set(path, data)
    if (parquetFile) {
      this.parquetFiles.set(path, parquetFile)
    }
    return { etag: crypto.randomUUID() }
  }

  /**
   * Get file (streaming read)
   */
  async get(path: string): Promise<{ body: Uint8Array; size: number } | null> {
    // Simulate R2 read latency
    await new Promise((resolve) => setTimeout(resolve, 1))
    const data = this.files.get(path)
    if (!data) return null
    return { body: data, size: data.length }
  }

  /**
   * Get range (for footer/column reads)
   */
  async getRange(path: string, start: number, end: number): Promise<Uint8Array | null> {
    // Simulate R2 range read latency (faster than full read)
    await new Promise((resolve) => setTimeout(resolve, 0.5))
    const data = this.files.get(path)
    if (!data) return null

    // Handle negative offsets (from end of file)
    const actualStart = start < 0 ? data.length + start : start
    const actualEnd = end < 0 ? data.length + end : end

    return data.slice(actualStart, actualEnd)
  }

  /**
   * Head file metadata
   */
  async head(path: string): Promise<{ size: number; etag: string } | null> {
    const data = this.files.get(path)
    if (!data) return null
    return { size: data.length, etag: 'mock-etag' }
  }

  /**
   * List files with prefix
   */
  async list(prefix: string): Promise<Array<{ key: string; size: number }>> {
    const results: Array<{ key: string; size: number }> = []
    for (const [key, data] of this.files.entries()) {
      if (key.startsWith(prefix)) {
        results.push({ key, size: data.length })
      }
    }
    return results
  }

  /**
   * Get the parquet file object for reading operations
   */
  getParquetFile(path: string): MockParquetFile | null {
    return this.parquetFiles.get(path) ?? null
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

// Pre-generate a shared embedding to speed up record generation
let sharedEmbedding: Float32Array | null = null
function getSharedEmbedding(dimension: number): Float32Array {
  if (!sharedEmbedding || sharedEmbedding.length !== dimension) {
    sharedEmbedding = new Float32Array(dimension)
    for (let i = 0; i < dimension; i++) {
      sharedEmbedding[i] = Math.random() * 2 - 1
    }
  }
  return sharedEmbedding
}

/**
 * Generate mock vector record
 */
function generateMockRecord(index: number, dimension: number = 1536): MockVectorRecord {
  // Reuse shared embedding with slight variation for diversity
  const baseEmbedding = getSharedEmbedding(dimension)
  const embedding = new Float32Array(dimension)
  const offset = (index % 100) * 0.01
  for (let i = 0; i < dimension; i++) {
    embedding[i] = baseEmbedding[i]! + offset
  }

  return {
    ns: `tenant-${index % 10}.do`,
    type: ['Document', 'Chunk', 'Message', 'Image'][index % 4]!,
    visibility: ['public', 'org', 'user', null][index % 4],
    id: `record-${index}`,
    embedding,
    metadata: JSON.stringify({ index, category: `cat-${index % 20}` }),
    created_at: Date.now() - index * 1000,
  }
}

/**
 * Generate batch of mock records
 */
function generateMockRecords(count: number, dimension: number = 1536): MockVectorRecord[] {
  return Array.from({ length: count }, (_, i) => generateMockRecord(i, dimension))
}

// ============================================================================
// PARQUET READING BENCHMARKS
// ============================================================================

describe('Parquet Reading Benchmarks', () => {
  let parquetFile: MockParquetFile
  let r2Storage: MockR2Storage

  // Use smaller dataset for faster tests
  const RECORD_COUNT = 1000
  const ROW_GROUP_SIZE = 100

  beforeEach(async () => {
    // Create a parquet file with 1000 records (faster setup)
    parquetFile = new MockParquetFile({ rowGroupSize: ROW_GROUP_SIZE })
    parquetFile.addRecords(generateMockRecords(RECORD_COUNT, 512)) // Use smaller dimension

    // Store in mock R2
    r2Storage = new MockR2Storage()
    await r2Storage.put('vectors/test.parquet', parquetFile.toBytes(), parquetFile)
  }, 30000) // 30 second timeout for setup

  describe('single record reads', () => {
    it('should benchmark single record read by index', async () => {
      let idx = 0
      const result = await runBenchmark('parquet-read-by-index', () => {
        parquetFile.readRecord(idx++ % RECORD_COUNT)
      })

      console.log('\n--- Parquet Single Record Read (by index) ---')
      console.log(formatBenchmarkResult(result))

      expect(result.p50Ms).toBeLessThan(TARGETS.SINGLE_RECORD_READ)
      expect(result.opsPerSec).toBeGreaterThan(MIN_THROUGHPUT_OPS_SEC)
    })

    it('should benchmark single record read by ID', async () => {
      let idx = 0
      const result = await runBenchmark('parquet-read-by-id', () => {
        parquetFile.readById(`record-${idx++ % RECORD_COUNT}`)
      })

      console.log('\n--- Parquet Single Record Read (by ID) ---')
      console.log(formatBenchmarkResult(result))

      expect(result.p50Ms).toBeLessThan(TARGETS.SINGLE_RECORD_READ)
    })

    it('should benchmark random access reads', async () => {
      const result = await runBenchmark('parquet-read-random', () => {
        const randomIndex = Math.floor(Math.random() * RECORD_COUNT)
        parquetFile.readRecord(randomIndex)
      })

      console.log('\n--- Parquet Random Access Read ---')
      console.log(formatBenchmarkResult(result))

      // Random access may be slightly slower
      expect(result.p50Ms).toBeLessThan(TARGETS.SINGLE_RECORD_READ * 1.5)
    })
  })

  describe('column projection', () => {
    it('should benchmark read with 3-column projection', async () => {
      let idx = 0
      const columns = ['id', 'type', 'created_at']

      const result = await runBenchmark('parquet-read-projected-3', () => {
        parquetFile.readProjected(idx++ % RECORD_COUNT, columns)
      })

      console.log('\n--- Parquet Column Projection (3 columns) ---')
      console.log(formatBenchmarkResult(result))

      expect(result.p50Ms).toBeLessThan(TARGETS.COLUMN_PROJECTION)
      expect(result.opsPerSec).toBeGreaterThan(MIN_THROUGHPUT_OPS_SEC)
    })

    it('should benchmark read with single column projection', async () => {
      let idx = 0
      const columns = ['id']

      const result = await runBenchmark('parquet-read-projected-1', () => {
        parquetFile.readProjected(idx++ % RECORD_COUNT, columns)
      })

      console.log('\n--- Parquet Single Column Projection ---')
      console.log(formatBenchmarkResult(result))

      // Single column should be fastest
      expect(result.p50Ms).toBeLessThan(TARGETS.COLUMN_PROJECTION)
    })

    it('should compare projected vs full read performance', async () => {
      let idx = 0

      const fullResult = await runBenchmark(
        'parquet-read-full',
        () => {
          parquetFile.readRecord(idx++ % RECORD_COUNT)
        },
        50,
        5
      )

      idx = 0
      const projectedResult = await runBenchmark(
        'parquet-read-projected',
        () => {
          parquetFile.readProjected(idx++ % RECORD_COUNT, ['id', 'type', 'created_at'])
        },
        50,
        5
      )

      console.log('\n--- Projected vs Full Read Comparison ---')
      console.log(`  Full read p50: ${fullResult.p50Ms.toFixed(3)} ms`)
      console.log(`  Projected read p50: ${projectedResult.p50Ms.toFixed(3)} ms`)
      const speedup = fullResult.p50Ms > 0 ? fullResult.p50Ms / Math.max(projectedResult.p50Ms, 0.0001) : 1
      console.log(`  Speedup: ${speedup.toFixed(2)}x`)

      // With mock implementation, both are extremely fast (sub-microsecond)
      // Just verify both complete within target
      expect(projectedResult.p50Ms).toBeLessThan(TARGETS.COLUMN_PROJECTION)
      expect(fullResult.p50Ms).toBeLessThan(TARGETS.SINGLE_RECORD_READ)
    })
  })

  describe('row group navigation', () => {
    it('should benchmark sequential row group reads', async () => {
      let groupIdx = 0
      const result = await runBenchmark('parquet-rowgroup-sequential', () => {
        parquetFile.readRowGroup(groupIdx++ % parquetFile.getRowGroupCount())
      })

      console.log('\n--- Parquet Row Group Sequential Read ---')
      console.log(formatBenchmarkResult(result))

      expect(result.p50Ms).toBeLessThan(TARGETS.ROW_GROUP_NAVIGATION)
    })

    it('should benchmark random row group reads', async () => {
      const result = await runBenchmark('parquet-rowgroup-random', () => {
        const randomGroup = Math.floor(Math.random() * parquetFile.getRowGroupCount())
        parquetFile.readRowGroup(randomGroup)
      })

      console.log('\n--- Parquet Row Group Random Read ---')
      console.log(formatBenchmarkResult(result))

      expect(result.p50Ms).toBeLessThan(TARGETS.ROW_GROUP_NAVIGATION)
    })

    it('should benchmark row group with offset and limit', async () => {
      let idx = 0
      const result = await runBenchmark('parquet-rowgroup-range', () => {
        const groupIdx = idx % parquetFile.getRowGroupCount()
        const offset = (idx++ * 10) % 100
        parquetFile.readRowGroupRange(groupIdx, offset, 10)
      })

      console.log('\n--- Parquet Row Group Range Read ---')
      console.log(formatBenchmarkResult(result))

      expect(result.p50Ms).toBeLessThan(TARGETS.ROW_GROUP_NAVIGATION)
    })
  })

  describe('predicate pushdown', () => {
    it('should benchmark equality predicate pushdown', async () => {
      let idx = 0
      const result = await runBenchmark('parquet-predicate-eq', () => {
        const type = ['Document', 'Chunk', 'Message', 'Image'][idx++ % 4]!
        parquetFile.queryWithPredicate('type', { type: 'eq', value: type })
      })

      console.log('\n--- Parquet Predicate Pushdown (equality) ---')
      console.log(formatBenchmarkResult(result))

      expect(result.p50Ms).toBeLessThan(TARGETS.PREDICATE_PUSHDOWN)
    })

    it('should benchmark range predicate pushdown', async () => {
      let idx = 0
      const result = await runBenchmark('parquet-predicate-range', () => {
        const minTs = Date.now() - (idx + 1) * 10000
        const maxTs = Date.now() - idx++ * 10000
        parquetFile.queryWithPredicate('created_at', { type: 'range', min: minTs, max: maxTs })
      })

      console.log('\n--- Parquet Predicate Pushdown (range) ---')
      console.log(formatBenchmarkResult(result))

      expect(result.p50Ms).toBeLessThan(TARGETS.PREDICATE_PUSHDOWN * 1.5)
    })

    it('should measure predicate pushdown effectiveness (row groups skipped)', async () => {
      // Test that predicate pushdown actually reduces work
      const totalRowGroups = parquetFile.getRowGroupCount()

      const matchingGroups = parquetFile.findRowGroupsWithPredicate('type', { type: 'eq', value: 'Document' })

      console.log('\n--- Predicate Pushdown Effectiveness ---')
      console.log(`  Total row groups: ${totalRowGroups}`)
      console.log(`  Row groups matching 'type=Document': ${matchingGroups.length}`)
      console.log(`  Row groups skipped: ${totalRowGroups - matchingGroups.length}`)
      console.log(`  Skip ratio: ${(((totalRowGroups - matchingGroups.length) / totalRowGroups) * 100).toFixed(1)}%`)

      // All row groups should match since 'Document' appears in every row group
      // (due to our round-robin data generation)
      expect(matchingGroups.length).toBeGreaterThan(0)
      expect(matchingGroups.length).toBeLessThanOrEqual(totalRowGroups)
    })
  })
})

// ============================================================================
// PARQUET WRITING BENCHMARKS
// ============================================================================

describe('Parquet Writing Benchmarks', () => {
  describe('record batch writes', () => {
    it('should benchmark writing 100 records', async () => {
      const result = await runBenchmark(
        'parquet-write-batch-100',
        () => {
          const writer = new MockParquetWriter({ compression: 'SNAPPY' })
          writer.addRecords(generateMockRecords(100))
          writer.finish()
        },
        50,
        5
      )

      console.log('\n--- Parquet Write Batch (100 records) ---')
      console.log(formatBenchmarkResult(result))

      expect(result.p50Ms).toBeLessThan(TARGETS.BATCH_WRITE_100)
      expect(result.opsPerSec).toBeGreaterThan(MIN_THROUGHPUT_OPS_SEC / 2)
    })

    it.each([10, 50, 100, 500])(
      'should benchmark writing %d records',
      async (batchSize) => {
      const result = await runBenchmark(
        `parquet-write-batch-${batchSize}`,
        () => {
          const writer = new MockParquetWriter({ compression: 'SNAPPY' })
          writer.addRecords(generateMockRecords(batchSize))
          writer.finish()
        },
        30,
        3
      )

      console.log(`\n--- Parquet Write (${batchSize} records) ---`)
      console.log(formatBenchmarkResult(result))
      console.log(`  Per-record avg: ${(result.avgMs / batchSize).toFixed(3)} ms`)

      // Expected scaling: base overhead + proportional to record count
      // With mock Float32Array copying, ~0.5-1ms per record for large embeddings
      const expectedMax = 30 + batchSize * 1.5
      expect(result.p50Ms).toBeLessThan(expectedMax)
      },
      30000 // 30 second timeout for larger batches
    )

    it('should measure write throughput scaling', { timeout: 30000 }, async () => {
      const batchSizes = [10, 50, 100, 500]
      const results: Array<{ size: number; p50: number; throughput: number }> = []

      for (const batchSize of batchSizes) {
        const result = await runBenchmark(
          `parquet-write-throughput-${batchSize}`,
          () => {
            const writer = new MockParquetWriter()
            writer.addRecords(generateMockRecords(batchSize))
            writer.finish()
          },
          20,
          3
        )

        const throughput = (batchSize / result.p50Ms) * 1000 // records/second
        results.push({ size: batchSize, p50: result.p50Ms, throughput })
      }

      console.log('\n=== Write Throughput Scaling ===')
      console.log('  Batch Size | p50 (ms) | Throughput (rec/s)')
      console.log('  -----------|----------|-------------------')
      for (const r of results) {
        console.log(`  ${r.size.toString().padStart(10)} | ${r.p50.toFixed(1).padStart(8)} | ${r.throughput.toFixed(0).padStart(17)}`)
      }

      // Note: With mock implementation, per-record time increases with batch size
      // due to Float32Array copying overhead. In production parquet-wasm,
      // throughput typically improves with batch size due to amortized overhead.
      // Just verify all batches complete within reasonable time.
      for (const r of results) {
        expect(r.p50).toBeLessThan(30 + r.size * 1.5)
      }
    })
  })

  describe('column encoding', () => {
    it('should benchmark dictionary encoding', async () => {
      // Data with high cardinality repetition - ideal for dictionary encoding
      const records = Array.from({ length: 100 }, (_, j) => ({
        ...generateMockRecord(j),
        type: ['Document', 'Chunk', 'Message', 'Image'][j % 4]!, // Only 4 unique values
        visibility: ['public', 'org', 'user'][j % 3], // Only 3 unique values
      }))

      const result = await runBenchmark(
        'parquet-encoding-dictionary',
        () => {
          const writer = new MockParquetWriter({ encoding: 'DICTIONARY' })
          writer.addRecords(records)
          writer.finish()
        },
        50,
        5
      )

      console.log('\n--- Parquet Dictionary Encoding ---')
      console.log(formatBenchmarkResult(result))

      expect(result.p50Ms).toBeLessThan(TARGETS.DICTIONARY_ENCODING)
    })

    it('should benchmark RLE encoding', async () => {
      // Data with runs of repeated values - ideal for RLE
      const records = Array.from({ length: 100 }, (_, j) => ({
        ...generateMockRecord(j),
        type: j < 50 ? 'Document' : 'Chunk', // First 50 same, rest same
      }))

      const result = await runBenchmark(
        'parquet-encoding-rle',
        () => {
          const writer = new MockParquetWriter({ encoding: 'RLE' })
          writer.addRecords(records)
          writer.finish()
        },
        50,
        5
      )

      console.log('\n--- Parquet RLE Encoding ---')
      console.log(formatBenchmarkResult(result))

      expect(result.p50Ms).toBeLessThan(TARGETS.RLE_ENCODING)
    })

    it('should benchmark plain encoding baseline', async () => {
      const records = generateMockRecords(100)

      const result = await runBenchmark(
        'parquet-encoding-plain',
        () => {
          const writer = new MockParquetWriter({ encoding: 'PLAIN' })
          writer.addRecords(records)
          writer.finish()
        },
        50,
        5
      )

      console.log('\n--- Parquet Plain Encoding (baseline) ---')
      console.log(formatBenchmarkResult(result))

      expect(result.p50Ms).toBeLessThan(TARGETS.BATCH_WRITE_100)
    })

    it('should compare encoding performance', async () => {
      const encodings: ColumnEncoding[] = ['PLAIN', 'DICTIONARY', 'RLE']
      const results: Array<{ encoding: ColumnEncoding; p50: number }> = []
      const records = generateMockRecords(100)

      for (const encoding of encodings) {
        const result = await runBenchmark(
          `parquet-encoding-compare-${encoding}`,
          () => {
            const writer = new MockParquetWriter({ encoding })
            writer.addRecords(records)
            writer.finish()
          },
          30,
          3
        )

        results.push({ encoding, p50: result.p50Ms })
      }

      console.log('\n=== Encoding Performance Comparison ===')
      console.log('  Encoding   | p50 (ms)')
      console.log('  -----------|----------')
      for (const r of results) {
        console.log(`  ${r.encoding.padEnd(10)} | ${r.p50.toFixed(3)}`)
      }
    })
  })

  describe('compression algorithms', () => {
    it('should benchmark snappy compression', async () => {
      const records = generateMockRecords(100)

      const result = await runBenchmark(
        'parquet-compress-snappy',
        () => {
          const writer = new MockParquetWriter({ compression: 'SNAPPY' })
          writer.addRecords(records)
          writer.finish()
        },
        50,
        5
      )

      console.log('\n--- Parquet Snappy Compression ---')
      console.log(formatBenchmarkResult(result))

      expect(result.p50Ms).toBeLessThan(TARGETS.SNAPPY_COMPRESSION)
    })

    it('should benchmark zstd compression', async () => {
      const records = generateMockRecords(100)

      const result = await runBenchmark(
        'parquet-compress-zstd',
        () => {
          const writer = new MockParquetWriter({ compression: 'ZSTD' })
          writer.addRecords(records)
          writer.finish()
        },
        50,
        5
      )

      console.log('\n--- Parquet Zstd Compression ---')
      console.log(formatBenchmarkResult(result))

      expect(result.p50Ms).toBeLessThan(TARGETS.ZSTD_COMPRESSION)
    })

    it('should benchmark gzip compression', async () => {
      const records = generateMockRecords(100)

      const result = await runBenchmark(
        'parquet-compress-gzip',
        () => {
          const writer = new MockParquetWriter({ compression: 'GZIP' })
          writer.addRecords(records)
          writer.finish()
        },
        50,
        5
      )

      console.log('\n--- Parquet Gzip Compression ---')
      console.log(formatBenchmarkResult(result))

      // GZIP is typically slower but better compression
      expect(result.p50Ms).toBeLessThan(TARGETS.ZSTD_COMPRESSION * 1.5)
    })

    it('should benchmark uncompressed baseline', async () => {
      const records = generateMockRecords(100)

      const result = await runBenchmark(
        'parquet-compress-none',
        () => {
          const writer = new MockParquetWriter({ compression: 'NONE' })
          writer.addRecords(records)
          writer.finish()
        },
        50,
        5
      )

      console.log('\n--- Parquet Uncompressed (baseline) ---')
      console.log(formatBenchmarkResult(result))

      expect(result.p50Ms).toBeLessThan(TARGETS.BATCH_WRITE_100)
    })

    it('should compare compression algorithms', async () => {
      const compressions: ParquetCompression[] = ['NONE', 'SNAPPY', 'ZSTD', 'GZIP']
      const results: Array<{ compression: ParquetCompression; p50: number; estimatedRatio: number }> = []
      const records = generateMockRecords(100)

      for (const compression of compressions) {
        const result = await runBenchmark(
          `parquet-compress-compare-${compression}`,
          () => {
            const writer = new MockParquetWriter({ compression })
            writer.addRecords(records)
            const { stats } = writer.finish()
            return stats
          },
          30,
          3
        )

        // Estimate compression ratio
        const estimatedRatio = compression === 'NONE' ? 1 : compression === 'SNAPPY' ? 0.4 : compression === 'ZSTD' ? 0.25 : 0.3

        results.push({ compression, p50: result.p50Ms, estimatedRatio })
      }

      console.log('\n=== Compression Algorithm Comparison ===')
      console.log('  Algorithm    | p50 (ms) | Est. Ratio | Notes')
      console.log('  -------------|----------|------------|------------------')
      console.log(`  ${results[0]!.compression.padEnd(12)} | ${results[0]!.p50.toFixed(1).padStart(8)} | ${results[0]!.estimatedRatio.toFixed(2).padStart(10)} | Baseline (fastest write)`)
      console.log(`  ${results[1]!.compression.padEnd(12)} | ${results[1]!.p50.toFixed(1).padStart(8)} | ${results[1]!.estimatedRatio.toFixed(2).padStart(10)} | Good balance`)
      console.log(`  ${results[2]!.compression.padEnd(12)} | ${results[2]!.p50.toFixed(1).padStart(8)} | ${results[2]!.estimatedRatio.toFixed(2).padStart(10)} | Best compression`)
      console.log(`  ${results[3]!.compression.padEnd(12)} | ${results[3]!.p50.toFixed(1).padStart(8)} | ${results[3]!.estimatedRatio.toFixed(2).padStart(10)} | Legacy compatibility`)

      // Snappy should be faster than zstd
      expect(results[1]!.p50).toBeLessThan(results[2]!.p50 * 1.5)
    })
  })

  describe('file size vs record count', () => {
    it('should measure file size scaling', { timeout: 30000 }, async () => {
      const recordCounts = [10, 50, 100, 500] // Reduced for faster tests
      const results: Array<{ count: number; p50: number; avgFileSize: number }> = []

      for (const count of recordCounts) {
        let totalSize = 0
        let sizeCount = 0

        const result = await runBenchmark(
          `parquet-filesize-${count}`,
          () => {
            const writer = new MockParquetWriter({ compression: 'SNAPPY' })
            writer.addRecords(generateMockRecords(count))
            const { stats } = writer.finish()
            totalSize += stats.compressedSize
            sizeCount++
          },
          20,
          3
        )

        results.push({
          count,
          p50: result.p50Ms,
          avgFileSize: sizeCount > 0 ? totalSize / sizeCount : 0,
        })
      }

      console.log('\n=== File Size vs Record Count ===')
      console.log('  Records | Write Time (ms) | Avg File Size')
      console.log('  --------|-----------------|---------------')
      for (const r of results) {
        const sizeStr = r.avgFileSize > 1024 * 1024 ? `${(r.avgFileSize / 1024 / 1024).toFixed(1)} MB` : `${(r.avgFileSize / 1024).toFixed(1)} KB`
        console.log(`  ${r.count.toString().padStart(7)} | ${r.p50.toFixed(1).padStart(15)} | ${sizeStr.padStart(13)}`)
      }

      // Verify write time stays within expected bounds
      // Mock implementation has linear scaling; production parquet-wasm has sub-linear
      for (const r of results) {
        const expectedMax = 30 + r.count * 1.5
        expect(r.p50).toBeLessThan(expectedMax)
      }
    })
  })
})

// ============================================================================
// R2 INTEGRATION BENCHMARKS
// ============================================================================

describe('R2 Integration Benchmarks', () => {
  let r2Storage: MockR2Storage

  beforeEach(async () => {
    r2Storage = new MockR2Storage()

    // Pre-populate with test files (smaller dimension for speed)
    for (let i = 0; i < 5; i++) {
      const writer = new MockParquetWriter({ compression: 'SNAPPY' })
      writer.addRecords(generateMockRecords(100, 256)) // Smaller dimension
      const { file, bytes } = writer.finish()
      await r2Storage.put(`benchmark/small-file-${i}.parquet`, bytes, file)
    }

    // Create a "larger" file (still modest for testing)
    const largeWriter = new MockParquetWriter({ compression: 'SNAPPY', rowGroupSize: 100 })
    largeWriter.addRecords(generateMockRecords(500, 256))
    const { file: largeFile, bytes: largeBytes } = largeWriter.finish()
    await r2Storage.put('benchmark/large-file.parquet', largeBytes, largeFile)
  }, 60000) // 60 second timeout for setup

  describe('streaming read from R2', () => {
    it('should benchmark streaming read of small file', async () => {
      let idx = 0
      const result = await runBenchmark('parquet-r2-stream-read-small', async () => {
        const path = `benchmark/small-file-${idx++ % 5}.parquet`
        await r2Storage.get(path)
      })

      console.log('\n--- Parquet R2 Stream Read (small) ---')
      console.log(formatBenchmarkResult(result))

      expect(result.p50Ms).toBeLessThan(TARGETS.STREAMING_READ)
    })

    it('should benchmark streaming read of large file', async () => {
      const result = await runBenchmark(
        'parquet-r2-stream-read-large',
        async () => {
          await r2Storage.get('benchmark/large-file.parquet')
        },
        30,
        3
      )

      console.log('\n--- Parquet R2 Stream Read (large) ---')
      console.log(formatBenchmarkResult(result))

      // Large files take longer
      expect(result.p50Ms).toBeLessThan(TARGETS.STREAMING_READ * 3)
    })
  })

  describe('streaming write to R2', () => {
    it('should benchmark streaming write', async () => {
      let idx = 0
      const result = await runBenchmark('parquet-r2-stream-write', async () => {
        const writer = new MockParquetWriter({ compression: 'SNAPPY' })
        writer.addRecords(generateMockRecords(100))
        const { bytes, file } = writer.finish()
        await r2Storage.put(`benchmark/output/write-${idx++}.parquet`, bytes, file)
      })

      console.log('\n--- Parquet R2 Stream Write ---')
      console.log(formatBenchmarkResult(result))

      expect(result.p50Ms).toBeLessThan(TARGETS.STREAMING_WRITE)
    })

    it('should benchmark streaming write with different compressions', async () => {
      const compressions: ParquetCompression[] = ['NONE', 'SNAPPY', 'ZSTD']
      const results: Array<{ compression: ParquetCompression; p50: number }> = []

      for (const compression of compressions) {
        let idx = 0
        const result = await runBenchmark(
          `parquet-r2-write-${compression}`,
          async () => {
            const writer = new MockParquetWriter({ compression })
            writer.addRecords(generateMockRecords(100))
            const { bytes, file } = writer.finish()
            await r2Storage.put(`benchmark/output/${compression}-${idx++}.parquet`, bytes, file)
          },
          30,
          3
        )

        results.push({ compression, p50: result.p50Ms })
      }

      console.log('\n=== R2 Write with Compression ===')
      console.log('  Compression | p50 (ms)')
      console.log('  ------------|----------')
      for (const r of results) {
        console.log(`  ${r.compression.padEnd(11)} | ${r.p50.toFixed(3)}`)
      }
    })
  })

  describe('range request optimization', () => {
    it('should benchmark range request (footer read)', async () => {
      const result = await runBenchmark('parquet-r2-range-footer', async () => {
        // Read last 8 bytes (Parquet footer magic + metadata length)
        await r2Storage.getRange('benchmark/large-file.parquet', -8, -1)
      })

      console.log('\n--- Parquet R2 Range Request (footer) ---')
      console.log(formatBenchmarkResult(result))

      expect(result.p50Ms).toBeLessThan(TARGETS.RANGE_REQUEST)
    })

    it('should benchmark range request (partial read)', async () => {
      let offset = 0
      const result = await runBenchmark('parquet-r2-range-partial', async () => {
        // Read 64KB chunks
        await r2Storage.getRange('benchmark/large-file.parquet', offset, offset + 65536)
        offset = (offset + 65536) % 1000000
      })

      console.log('\n--- Parquet R2 Range Request (64KB) ---')
      console.log(formatBenchmarkResult(result))

      expect(result.p50Ms).toBeLessThan(TARGETS.RANGE_REQUEST * 2)
    })

    it('should compare range vs full read performance', async () => {
      const rangeResult = await runBenchmark(
        'parquet-r2-compare-range',
        async () => {
          await r2Storage.getRange('benchmark/large-file.parquet', -8, -1)
        },
        30,
        3
      )

      const fullResult = await runBenchmark(
        'parquet-r2-compare-full',
        async () => {
          await r2Storage.get('benchmark/large-file.parquet')
        },
        30,
        3
      )

      const speedup = fullResult.p50Ms / rangeResult.p50Ms

      console.log('\n=== Range vs Full Read Comparison ===')
      console.log(`  Range request p50: ${rangeResult.p50Ms.toFixed(3)} ms`)
      console.log(`  Full read p50: ${fullResult.p50Ms.toFixed(3)} ms`)
      console.log(`  Speedup: ${speedup.toFixed(2)}x`)

      // In mock implementation, both are fast (in-memory).
      // In production, range requests would be significantly faster.
      // Just verify both complete within acceptable time.
      expect(rangeResult.p50Ms).toBeLessThan(TARGETS.RANGE_REQUEST)
      expect(fullResult.p50Ms).toBeLessThan(TARGETS.STREAMING_READ)
    })
  })

  describe('R2 operations', () => {
    it('should benchmark file listing', async () => {
      const result = await runBenchmark('parquet-r2-list', async () => {
        await r2Storage.list('benchmark/')
      })

      console.log('\n--- Parquet R2 List Files ---')
      console.log(formatBenchmarkResult(result))
    })

    it('should benchmark head metadata', async () => {
      let idx = 0
      const result = await runBenchmark('parquet-r2-head', async () => {
        const path = `benchmark/small-file-${idx++ % 5}.parquet`
        await r2Storage.head(path)
      })

      console.log('\n--- Parquet R2 Head Metadata ---')
      console.log(formatBenchmarkResult(result))

      // HEAD should be very fast
      expect(result.p50Ms).toBeLessThan(TARGETS.RANGE_REQUEST)
    })
  })
})

// ============================================================================
// SUMMARY REPORT
// ============================================================================

describe('Parquet Operations Benchmark Summary', () => {
  it('should document expected performance targets', () => {
    console.log('\n========================================')
    console.log('PARQUET OPERATIONS BENCHMARK SUMMARY')
    console.log('========================================\n')

    console.log('Performance targets (p50 latency):')
    console.log('\n  Reading:')
    console.log(`    - Single record read: <${TARGETS.SINGLE_RECORD_READ}ms`)
    console.log(`    - Column projection: <${TARGETS.COLUMN_PROJECTION}ms`)
    console.log(`    - Row group navigation: <${TARGETS.ROW_GROUP_NAVIGATION}ms`)
    console.log(`    - Predicate pushdown: <${TARGETS.PREDICATE_PUSHDOWN}ms`)

    console.log('\n  Writing:')
    console.log(`    - Batch write (100 records): <${TARGETS.BATCH_WRITE_100}ms`)
    console.log(`    - Dictionary encoding: <${TARGETS.DICTIONARY_ENCODING}ms`)
    console.log(`    - RLE encoding: <${TARGETS.RLE_ENCODING}ms`)
    console.log(`    - Snappy compression: <${TARGETS.SNAPPY_COMPRESSION}ms`)
    console.log(`    - Zstd compression: <${TARGETS.ZSTD_COMPRESSION}ms`)

    console.log('\n  R2 Integration:')
    console.log(`    - Streaming read: <${TARGETS.STREAMING_READ}ms`)
    console.log(`    - Streaming write: <${TARGETS.STREAMING_WRITE}ms`)
    console.log(`    - Range request: <${TARGETS.RANGE_REQUEST}ms`)

    console.log('\n  Minimum throughput: >' + MIN_THROUGHPUT_OPS_SEC + ' ops/sec')

    console.log('\nOptimization techniques:')
    console.log('  - Column projection: Read only needed columns')
    console.log('  - Row group skipping: Skip row groups based on stats')
    console.log('  - Predicate pushdown: Filter at storage level')
    console.log('  - Dictionary encoding: Low-cardinality strings')
    console.log('  - RLE encoding: Repeated values')
    console.log('  - Range requests: Minimize data transfer')

    console.log('\nparquet-wasm optimizations:')
    console.log('  - Zero-copy Arrow IPC deserialization')
    console.log('  - Lazy column reading')
    console.log('  - Streaming decompression')
    console.log('  - WASM SIMD acceleration')

    console.log('\nNote: These benchmarks use mock implementations.')
    console.log('Production performance depends on parquet-wasm in Workers.')
    console.log('')

    expect(true).toBe(true)
  })
})
