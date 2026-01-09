/**
 * Parquet Full-Vector Writer Tests
 *
 * Tests for the Parquet writer that stores full vectors in R2 for reranking.
 * This is used in the Static Assets Vector Search architecture where coarse
 * search uses static assets (FREE) and only reranking fetches full vectors
 * from R2 Parquet files.
 *
 * Schema Requirements:
 * - id: string (vector ID)
 * - cluster_id: int32 (for partitioning and efficient reads)
 * - vector: FixedSizeList[float32, 1536] (full embedding)
 * - metadata: string (optional, JSON serialized)
 *
 * Performance Requirements:
 * - ZSTD compression (best compression/speed ratio)
 * - Row group size: 1000-2000 vectors (balance predicate pushdown and write perf)
 * - Compatible with parquet-wasm reader
 *
 * TDD Phase: RED - All tests should FAIL initially
 *
 * @see docs/plans/static-assets-vector-search.md - Architecture overview
 * @see docs/research/parquet-wasm-iceberg.md - parquet-wasm capabilities
 * @module tests/vector/parquet-vector-writer.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Import types and implementation that will be created
import {
  ParquetVectorWriter,
  type ParquetVectorWriterConfig,
  type VectorRecord,
  type WriteResult,
  type ParquetSchema,
  createVectorParquetSchema,
  PARQUET_VECTOR_SCHEMA_1536,
} from '../../db/vector/parquet-vector-writer'

// ============================================================================
// TEST UTILITIES
// ============================================================================

/**
 * Generate a random unit vector
 */
function generateRandomVector(dimensions: number, seed?: number): Float32Array {
  const vec = new Float32Array(dimensions)
  let s = seed ?? Math.random() * 10000
  for (let i = 0; i < dimensions; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    vec[i] = (s / 0x7fffffff) * 2 - 1
  }
  // Normalize
  let norm = 0
  for (let i = 0; i < dimensions; i++) {
    norm += vec[i] * vec[i]
  }
  norm = Math.sqrt(norm)
  for (let i = 0; i < dimensions; i++) {
    vec[i] /= norm
  }
  return vec
}

/**
 * Generate test vector records
 */
function generateTestRecords(
  count: number,
  dimensions: number = 1536,
  options: {
    includeMetadata?: boolean
    clusterCount?: number
  } = {}
): VectorRecord[] {
  const { includeMetadata = true, clusterCount = 10 } = options

  return Array.from({ length: count }, (_, i) => ({
    id: `vec_${i.toString().padStart(8, '0')}`,
    clusterId: i % clusterCount,
    vector: generateRandomVector(dimensions, i),
    metadata: includeMetadata
      ? JSON.stringify({
          type: ['document', 'chunk', 'entity'][i % 3],
          index: i,
          createdAt: Date.now() - i * 1000,
        })
      : undefined,
  }))
}

/**
 * Verify Parquet file magic bytes
 */
function verifyParquetMagic(data: Uint8Array): boolean {
  // Parquet files start with PAR1 and end with PAR1
  if (data.length < 8) return false
  const startMagic =
    data[0] === 0x50 && // 'P'
    data[1] === 0x41 && // 'A'
    data[2] === 0x52 && // 'R'
    data[3] === 0x31 // '1'
  const endMagic =
    data[data.length - 4] === 0x50 &&
    data[data.length - 3] === 0x41 &&
    data[data.length - 2] === 0x52 &&
    data[data.length - 1] === 0x31
  return startMagic && endMagic
}

// ============================================================================
// TESTS: Schema Definition
// ============================================================================

describe('Parquet Full-Vector Writer', () => {
  describe('Schema Definition', () => {
    it('should create schema with vector ID column as string', () => {
      const schema = createVectorParquetSchema({ dimensions: 1536 })

      const idField = schema.fields.find((f) => f.name === 'id')
      expect(idField).toBeDefined()
      expect(idField!.type).toBe('utf8')
      expect(idField!.nullable).toBe(false)
    })

    it('should create schema with cluster_id column as int32', () => {
      const schema = createVectorParquetSchema({ dimensions: 1536 })

      const clusterField = schema.fields.find((f) => f.name === 'cluster_id')
      expect(clusterField).toBeDefined()
      expect(clusterField!.type).toBe('int32')
      expect(clusterField!.nullable).toBe(false)
    })

    it('should create schema with full 1536-dim vector as fixed-size list', () => {
      const schema = createVectorParquetSchema({ dimensions: 1536 })

      const vectorField = schema.fields.find((f) => f.name === 'vector')
      expect(vectorField).toBeDefined()
      expect(vectorField!.type).toBe('fixed_size_list')
      expect(vectorField!.listSize).toBe(1536)
      expect(vectorField!.elementType).toBe('float32')
      expect(vectorField!.nullable).toBe(false)
    })

    it('should create schema with optional metadata column', () => {
      const schema = createVectorParquetSchema({
        dimensions: 1536,
        includeMetadata: true,
      })

      const metadataField = schema.fields.find((f) => f.name === 'metadata')
      expect(metadataField).toBeDefined()
      expect(metadataField!.type).toBe('utf8')
      expect(metadataField!.nullable).toBe(true)
    })

    it('should support custom dimensions', () => {
      const schema3072 = createVectorParquetSchema({ dimensions: 3072 })
      const vectorField = schema3072.fields.find((f) => f.name === 'vector')
      expect(vectorField!.listSize).toBe(3072)

      const schema384 = createVectorParquetSchema({ dimensions: 384 })
      const vectorField384 = schema384.fields.find((f) => f.name === 'vector')
      expect(vectorField384!.listSize).toBe(384)
    })

    it('should provide pre-defined 1536-dim schema constant', () => {
      expect(PARQUET_VECTOR_SCHEMA_1536).toBeDefined()
      expect(PARQUET_VECTOR_SCHEMA_1536.dimensions).toBe(1536)

      const vectorField = PARQUET_VECTOR_SCHEMA_1536.fields.find(
        (f) => f.name === 'vector'
      )
      expect(vectorField!.listSize).toBe(1536)
    })
  })

  // ============================================================================
  // TESTS: Write Operations
  // ============================================================================

  describe('Write Operations', () => {
    let writer: ParquetVectorWriter

    beforeEach(() => {
      writer = new ParquetVectorWriter({
        dimensions: 1536,
        compression: 'ZSTD',
        rowGroupSize: 1000,
      })
    })

    it('should write vectors to Parquet file with correct schema', async () => {
      const records = generateTestRecords(100)

      const result = await writer.write(records)

      expect(result.data).toBeInstanceOf(Uint8Array)
      expect(result.data.length).toBeGreaterThan(0)
      expect(verifyParquetMagic(result.data)).toBe(true)
    })

    it('should include vector ID column in output', async () => {
      const records = generateTestRecords(10)

      const result = await writer.write(records)

      // Verify by reading back
      const readResult = await writer.readBack(result.data)
      expect(readResult.columns).toContain('id')

      for (let i = 0; i < 10; i++) {
        expect(readResult.rows[i].id).toBe(records[i].id)
      }
    })

    it('should include cluster_id column for partitioning', async () => {
      const records = generateTestRecords(20, 1536, { clusterCount: 4 })

      const result = await writer.write(records)

      const readResult = await writer.readBack(result.data)
      expect(readResult.columns).toContain('cluster_id')

      for (let i = 0; i < 20; i++) {
        expect(readResult.rows[i].cluster_id).toBe(records[i].clusterId)
      }
    })

    it('should include full 1536-dim vector as fixed-size list', async () => {
      const records = generateTestRecords(5)

      const result = await writer.write(records)

      const readResult = await writer.readBack(result.data)
      expect(readResult.columns).toContain('vector')

      for (let i = 0; i < 5; i++) {
        const readVector = readResult.rows[i].vector as Float32Array
        expect(readVector.length).toBe(1536)

        // Verify vector values match (within floating point tolerance)
        for (let j = 0; j < 1536; j++) {
          expect(readVector[j]).toBeCloseTo(records[i].vector[j], 5)
        }
      }
    })

    it('should include optional metadata columns', async () => {
      const recordsWithMeta = generateTestRecords(10, 1536, {
        includeMetadata: true,
      })
      const recordsWithoutMeta = generateTestRecords(5, 1536, {
        includeMetadata: false,
      })

      // Write with metadata
      const result1 = await writer.write(recordsWithMeta)
      const readResult1 = await writer.readBack(result1.data)
      expect(readResult1.columns).toContain('metadata')

      for (let i = 0; i < 10; i++) {
        expect(readResult1.rows[i].metadata).toBe(recordsWithMeta[i].metadata)
      }

      // Write without metadata
      const result2 = await writer.write(recordsWithoutMeta)
      const readResult2 = await writer.readBack(result2.data)

      for (let i = 0; i < 5; i++) {
        expect(readResult2.rows[i].metadata).toBeNull()
      }
    })

    it('should use ZSTD compression', async () => {
      const records = generateTestRecords(500)

      const zstdWriter = new ParquetVectorWriter({
        dimensions: 1536,
        compression: 'ZSTD',
        rowGroupSize: 1000,
      })

      const uncompressedWriter = new ParquetVectorWriter({
        dimensions: 1536,
        compression: 'UNCOMPRESSED',
        rowGroupSize: 1000,
      })

      const zstdResult = await zstdWriter.write(records)
      const uncompressedResult = await uncompressedWriter.write(records)

      // ZSTD should produce smaller file
      expect(zstdResult.data.length).toBeLessThan(uncompressedResult.data.length)

      // Verify compression ratio is meaningful (at least 1.5x)
      const ratio = uncompressedResult.data.length / zstdResult.data.length
      expect(ratio).toBeGreaterThan(1.5)

      // Both should still be valid Parquet
      expect(verifyParquetMagic(zstdResult.data)).toBe(true)
      expect(verifyParquetMagic(uncompressedResult.data)).toBe(true)
    })

    it('should configure row group size (1000-2000 vectors)', async () => {
      const records = generateTestRecords(3000)

      const writer1000 = new ParquetVectorWriter({
        dimensions: 1536,
        compression: 'ZSTD',
        rowGroupSize: 1000,
      })

      const writer2000 = new ParquetVectorWriter({
        dimensions: 1536,
        compression: 'ZSTD',
        rowGroupSize: 2000,
      })

      const result1000 = await writer1000.write(records)
      const result2000 = await writer2000.write(records)

      // Verify row group counts
      expect(result1000.rowGroupCount).toBe(3) // 3000 / 1000
      expect(result2000.rowGroupCount).toBe(2) // 3000 / 2000 = 1.5, rounded up to 2
    })

    it('should validate row group size within recommended range', () => {
      expect(() => {
        new ParquetVectorWriter({
          dimensions: 1536,
          compression: 'ZSTD',
          rowGroupSize: 100, // Too small
        })
      }).toThrow(/rowGroupSize.*1000.*2000/i)

      expect(() => {
        new ParquetVectorWriter({
          dimensions: 1536,
          compression: 'ZSTD',
          rowGroupSize: 10000, // Too large
        })
      }).toThrow(/rowGroupSize.*1000.*2000/i)

      // Valid range should work
      expect(() => {
        new ParquetVectorWriter({
          dimensions: 1536,
          compression: 'ZSTD',
          rowGroupSize: 1500,
        })
      }).not.toThrow()
    })
  })

  // ============================================================================
  // TESTS: Read Back and Verification
  // ============================================================================

  describe('Read Back and Verification', () => {
    let writer: ParquetVectorWriter

    beforeEach(() => {
      writer = new ParquetVectorWriter({
        dimensions: 1536,
        compression: 'ZSTD',
        rowGroupSize: 1000,
      })
    })

    it('should read back written file and verify contents', async () => {
      const records = generateTestRecords(50)

      const writeResult = await writer.write(records)
      const readResult = await writer.readBack(writeResult.data)

      expect(readResult.rowCount).toBe(50)
      expect(readResult.columns).toEqual(
        expect.arrayContaining(['id', 'cluster_id', 'vector', 'metadata'])
      )

      // Verify all records match
      for (let i = 0; i < 50; i++) {
        const original = records[i]
        const read = readResult.rows.find((r) => r.id === original.id)

        expect(read).toBeDefined()
        expect(read!.cluster_id).toBe(original.clusterId)
        expect(read!.metadata).toBe(original.metadata)

        // Vector comparison with tolerance
        const readVector = read!.vector as Float32Array
        for (let j = 0; j < 1536; j++) {
          expect(readVector[j]).toBeCloseTo(original.vector[j], 5)
        }
      }
    })

    it('should support column projection on read', async () => {
      const records = generateTestRecords(100)

      const writeResult = await writer.write(records)

      // Read only id and cluster_id (no vector - saves memory)
      const readResult = await writer.readBack(writeResult.data, {
        columns: ['id', 'cluster_id'],
      })

      expect(readResult.columns).toEqual(['id', 'cluster_id'])
      expect(readResult.rows[0].vector).toBeUndefined()
      expect(readResult.rows[0].id).toBeDefined()
      expect(readResult.rows[0].cluster_id).toBeDefined()
    })

    it('should support row group filtering on read', async () => {
      const records = generateTestRecords(2000)

      const writeResult = await writer.write(records)

      // Read only specific row groups
      const readResult = await writer.readBack(writeResult.data, {
        rowGroups: [0], // Only first row group
      })

      expect(readResult.rowCount).toBe(1000) // One row group worth
    })

    it('should preserve vector precision through round-trip', async () => {
      // Use specific known values to test precision
      const specificRecords: VectorRecord[] = [
        {
          id: 'precise_1',
          clusterId: 0,
          vector: new Float32Array(1536).fill(0.123456789),
        },
        {
          id: 'precise_2',
          clusterId: 0,
          vector: new Float32Array(1536).fill(-0.987654321),
        },
        {
          id: 'precise_3',
          clusterId: 0,
          vector: (() => {
            const v = new Float32Array(1536)
            for (let i = 0; i < 1536; i++) {
              v[i] = Math.PI * (i / 1536) - Math.PI / 2
            }
            return v
          })(),
        },
      ]

      const writeResult = await writer.write(specificRecords)
      const readResult = await writer.readBack(writeResult.data)

      for (const original of specificRecords) {
        const read = readResult.rows.find((r) => r.id === original.id)
        expect(read).toBeDefined()

        const readVector = read!.vector as Float32Array
        for (let j = 0; j < 1536; j++) {
          // Float32 precision is ~7 decimal digits
          expect(readVector[j]).toBeCloseTo(original.vector[j], 5)
        }
      }
    })
  })

  // ============================================================================
  // TESTS: Batch Writes (10K+ vectors)
  // ============================================================================

  describe('Batch Writes (10K+ vectors)', () => {
    it('should handle batch writes of 10K+ vectors', async () => {
      const writer = new ParquetVectorWriter({
        dimensions: 1536,
        compression: 'ZSTD',
        rowGroupSize: 2000,
      })

      // Use smaller dimensions for faster test execution
      const records = generateTestRecords(10000, 384)
      const dimensionWriter = new ParquetVectorWriter({
        dimensions: 384,
        compression: 'ZSTD',
        rowGroupSize: 2000,
      })

      const result = await dimensionWriter.write(records)

      expect(result.rowCount).toBe(10000)
      expect(result.rowGroupCount).toBe(5) // 10000 / 2000
      expect(verifyParquetMagic(result.data)).toBe(true)

      // Verify file size is reasonable
      // 10K vectors * 384 dims * 4 bytes = 15.36 MB uncompressed
      // With ZSTD, expect at least 2x compression
      const uncompressedEstimate = 10000 * 384 * 4
      expect(result.data.length).toBeLessThan(uncompressedEstimate)
    })

    it('should handle 50K vectors efficiently', async () => {
      const writer = new ParquetVectorWriter({
        dimensions: 128, // Smaller for test speed
        compression: 'ZSTD',
        rowGroupSize: 2000,
      })

      const records = generateTestRecords(50000, 128)

      const startTime = performance.now()
      const result = await writer.write(records)
      const endTime = performance.now()

      expect(result.rowCount).toBe(50000)
      expect(result.rowGroupCount).toBe(25) // 50000 / 2000

      // Should complete in reasonable time (< 10 seconds)
      const elapsedMs = endTime - startTime
      expect(elapsedMs).toBeLessThan(10000)

      console.log(
        `[TEST] 50K vectors (128-dim): ${(result.data.length / (1024 * 1024)).toFixed(2)} MB, ${elapsedMs.toFixed(0)}ms`
      )
    })

    it('should stream large batches to avoid memory pressure', async () => {
      const writer = new ParquetVectorWriter({
        dimensions: 256,
        compression: 'ZSTD',
        rowGroupSize: 1000,
        streaming: true, // Enable streaming mode
      })

      // Generate records lazily
      async function* generateRecordsAsync(
        count: number
      ): AsyncGenerator<VectorRecord> {
        for (let i = 0; i < count; i++) {
          yield {
            id: `vec_${i.toString().padStart(8, '0')}`,
            clusterId: i % 10,
            vector: generateRandomVector(256, i),
          }
        }
      }

      const result = await writer.writeStream(generateRecordsAsync(20000))

      expect(result.rowCount).toBe(20000)
      expect(verifyParquetMagic(result.data)).toBe(true)
    })

    it('should report write statistics for large batches', async () => {
      const writer = new ParquetVectorWriter({
        dimensions: 256,
        compression: 'ZSTD',
        rowGroupSize: 1000,
      })

      const records = generateTestRecords(5000, 256)

      const result = await writer.write(records)

      expect(result.stats).toBeDefined()
      expect(result.stats.rowCount).toBe(5000)
      expect(result.stats.rowGroupCount).toBe(5)
      expect(result.stats.compressedSizeBytes).toBe(result.data.length)
      expect(result.stats.uncompressedSizeBytes).toBeGreaterThan(
        result.stats.compressedSizeBytes
      )
      expect(result.stats.compressionRatio).toBeGreaterThan(1)
      expect(result.stats.writeTimeMs).toBeGreaterThan(0)
    })
  })

  // ============================================================================
  // TESTS: parquet-wasm Compatibility
  // ============================================================================

  describe('parquet-wasm Compatibility', () => {
    let writer: ParquetVectorWriter

    beforeEach(() => {
      writer = new ParquetVectorWriter({
        dimensions: 1536,
        compression: 'ZSTD',
        rowGroupSize: 1000,
      })
    })

    it('should output file compatible with parquet-wasm reader', async () => {
      const records = generateTestRecords(100)

      const writeResult = await writer.write(records)

      // Verify using parquet-wasm reader (imported dynamically)
      const parquetWasmCompatible = await writer.verifyParquetWasmCompatibility(
        writeResult.data
      )

      expect(parquetWasmCompatible.valid).toBe(true)
      expect(parquetWasmCompatible.rowCount).toBe(100)
      expect(parquetWasmCompatible.schema).toBeDefined()
      expect(parquetWasmCompatible.schema.fields).toContainEqual(
        expect.objectContaining({ name: 'id' })
      )
      expect(parquetWasmCompatible.schema.fields).toContainEqual(
        expect.objectContaining({ name: 'cluster_id' })
      )
      expect(parquetWasmCompatible.schema.fields).toContainEqual(
        expect.objectContaining({ name: 'vector' })
      )
    })

    it('should include correct Parquet file metadata', async () => {
      const records = generateTestRecords(50)

      const writeResult = await writer.write(records)

      const metadata = await writer.readFileMetadata(writeResult.data)

      expect(metadata.rowCount).toBe(50)
      expect(metadata.rowGroupCount).toBeGreaterThan(0)
      expect(metadata.createdBy).toContain('dotdo')
      expect(metadata.schema).toBeDefined()
    })

    it('should write with statistics enabled for predicate pushdown', async () => {
      const records = generateTestRecords(2000)

      const writeResult = await writer.write(records)

      const metadata = await writer.readFileMetadata(writeResult.data)

      // Each row group should have column statistics
      for (const rowGroup of metadata.rowGroups) {
        expect(rowGroup.columns.id.statistics).toBeDefined()
        expect(rowGroup.columns.id.statistics.min).toBeDefined()
        expect(rowGroup.columns.id.statistics.max).toBeDefined()
        expect(rowGroup.columns.cluster_id.statistics).toBeDefined()
        expect(rowGroup.columns.cluster_id.statistics.min).toBeDefined()
        expect(rowGroup.columns.cluster_id.statistics.max).toBeDefined()
      }
    })

    it('should be readable by Arrow IPC', async () => {
      const records = generateTestRecords(100)

      const writeResult = await writer.write(records)

      // Convert to Arrow IPC format for verification
      const arrowTable = await writer.toArrowTable(writeResult.data)

      expect(arrowTable).toBeDefined()
      expect(arrowTable.numRows).toBe(100)
      expect(arrowTable.schema.fields.map((f) => f.name)).toContain('id')
      expect(arrowTable.schema.fields.map((f) => f.name)).toContain('cluster_id')
      expect(arrowTable.schema.fields.map((f) => f.name)).toContain('vector')
    })
  })

  // ============================================================================
  // TESTS: Compression Options
  // ============================================================================

  describe('Compression Options', () => {
    const compressionOptions: Array<
      'ZSTD' | 'SNAPPY' | 'LZ4' | 'GZIP' | 'BROTLI' | 'UNCOMPRESSED'
    > = ['ZSTD', 'SNAPPY', 'LZ4', 'GZIP', 'BROTLI', 'UNCOMPRESSED']

    for (const compression of compressionOptions) {
      it(`should support ${compression} compression`, async () => {
        const writer = new ParquetVectorWriter({
          dimensions: 256,
          compression,
          rowGroupSize: 1000,
        })

        const records = generateTestRecords(500, 256)
        const result = await writer.write(records)

        expect(result.data.length).toBeGreaterThan(0)
        expect(verifyParquetMagic(result.data)).toBe(true)

        // Verify round-trip works
        const readResult = await writer.readBack(result.data)
        expect(readResult.rowCount).toBe(500)

        console.log(
          `[TEST] ${compression}: ${(result.data.length / 1024).toFixed(2)} KB`
        )
      })
    }

    it('should default to ZSTD compression', () => {
      const writer = new ParquetVectorWriter({
        dimensions: 1536,
        rowGroupSize: 1000,
      })

      expect(writer.config.compression).toBe('ZSTD')
    })
  })

  // ============================================================================
  // TESTS: Error Handling
  // ============================================================================

  describe('Error Handling', () => {
    it('should reject records with wrong vector dimension', async () => {
      const writer = new ParquetVectorWriter({
        dimensions: 1536,
        compression: 'ZSTD',
        rowGroupSize: 1000,
      })

      const badRecords: VectorRecord[] = [
        {
          id: 'bad_vec',
          clusterId: 0,
          vector: new Float32Array(512), // Wrong dimension
        },
      ]

      await expect(writer.write(badRecords)).rejects.toThrow(
        /dimension.*mismatch/i
      )
    })

    it('should reject empty id', async () => {
      const writer = new ParquetVectorWriter({
        dimensions: 1536,
        compression: 'ZSTD',
        rowGroupSize: 1000,
      })

      const badRecords: VectorRecord[] = [
        {
          id: '', // Empty ID
          clusterId: 0,
          vector: generateRandomVector(1536),
        },
      ]

      await expect(writer.write(badRecords)).rejects.toThrow(/non-empty.*id/i)
    })

    it('should reject negative cluster_id', async () => {
      const writer = new ParquetVectorWriter({
        dimensions: 1536,
        compression: 'ZSTD',
        rowGroupSize: 1000,
      })

      const badRecords: VectorRecord[] = [
        {
          id: 'vec_001',
          clusterId: -1, // Invalid cluster ID
          vector: generateRandomVector(1536),
        },
      ]

      await expect(writer.write(badRecords)).rejects.toThrow(
        /cluster_id.*non-negative/i
      )
    })

    it('should handle empty records array', async () => {
      const writer = new ParquetVectorWriter({
        dimensions: 1536,
        compression: 'ZSTD',
        rowGroupSize: 1000,
      })

      const result = await writer.write([])

      expect(result.rowCount).toBe(0)
      expect(result.data.length).toBeGreaterThan(0) // Still valid Parquet with schema
      expect(verifyParquetMagic(result.data)).toBe(true)
    })

    it('should handle NaN values in vectors', async () => {
      const writer = new ParquetVectorWriter({
        dimensions: 1536,
        compression: 'ZSTD',
        rowGroupSize: 1000,
      })

      const nanRecords: VectorRecord[] = [
        {
          id: 'nan_vec',
          clusterId: 0,
          vector: (() => {
            const v = generateRandomVector(1536)
            v[100] = NaN
            return v
          })(),
        },
      ]

      await expect(writer.write(nanRecords)).rejects.toThrow(/NaN.*vector/i)
    })

    it('should handle Infinity values in vectors', async () => {
      const writer = new ParquetVectorWriter({
        dimensions: 1536,
        compression: 'ZSTD',
        rowGroupSize: 1000,
      })

      const infRecords: VectorRecord[] = [
        {
          id: 'inf_vec',
          clusterId: 0,
          vector: (() => {
            const v = generateRandomVector(1536)
            v[500] = Infinity
            return v
          })(),
        },
      ]

      await expect(writer.write(infRecords)).rejects.toThrow(/Infinity.*vector/i)
    })
  })

  // ============================================================================
  // TESTS: File Metadata and Custom Properties
  // ============================================================================

  describe('File Metadata and Custom Properties', () => {
    it('should store custom key-value metadata in Parquet footer', async () => {
      const writer = new ParquetVectorWriter({
        dimensions: 1536,
        compression: 'ZSTD',
        rowGroupSize: 1000,
        fileMetadata: new Map([
          ['dotdo:schema_version', '1.0.0'],
          ['dotdo:namespace', 'vectors.do'],
          ['dotdo:created_at', new Date().toISOString()],
        ]),
      })

      const records = generateTestRecords(10)
      const result = await writer.write(records)

      const metadata = await writer.readFileMetadata(result.data)

      expect(metadata.keyValueMetadata.get('dotdo:schema_version')).toBe('1.0.0')
      expect(metadata.keyValueMetadata.get('dotdo:namespace')).toBe('vectors.do')
      expect(metadata.keyValueMetadata.has('dotdo:created_at')).toBe(true)
    })

    it('should include Iceberg-compatible schema metadata', async () => {
      const writer = new ParquetVectorWriter({
        dimensions: 1536,
        compression: 'ZSTD',
        rowGroupSize: 1000,
        icebergCompatible: true,
      })

      const records = generateTestRecords(100)
      const result = await writer.write(records)

      const metadata = await writer.readFileMetadata(result.data)

      expect(metadata.keyValueMetadata.has('iceberg.schema')).toBe(true)
      const icebergSchema = JSON.parse(
        metadata.keyValueMetadata.get('iceberg.schema')!
      )
      expect(icebergSchema.fields).toBeDefined()
    })
  })

  // ============================================================================
  // TESTS: Partitioning by Cluster
  // ============================================================================

  describe('Partitioning by Cluster', () => {
    it('should group vectors by cluster_id in row groups', async () => {
      const writer = new ParquetVectorWriter({
        dimensions: 256,
        compression: 'ZSTD',
        rowGroupSize: 500,
        partitionByCluster: true,
      })

      // Create records with 4 distinct clusters
      const records: VectorRecord[] = []
      for (let clusterId = 0; clusterId < 4; clusterId++) {
        for (let i = 0; i < 500; i++) {
          records.push({
            id: `cluster${clusterId}_vec${i}`,
            clusterId,
            vector: generateRandomVector(256, clusterId * 1000 + i),
          })
        }
      }

      const result = await writer.write(records)

      // Should have 4 row groups (one per cluster)
      expect(result.rowGroupCount).toBe(4)

      const metadata = await writer.readFileMetadata(result.data)

      // Each row group should have vectors from only one cluster
      for (const rowGroup of metadata.rowGroups) {
        const minClusterId = rowGroup.columns.cluster_id.statistics.min
        const maxClusterId = rowGroup.columns.cluster_id.statistics.max
        expect(minClusterId).toBe(maxClusterId) // All same cluster in row group
      }
    })

    it('should enable efficient cluster-based reads', async () => {
      const writer = new ParquetVectorWriter({
        dimensions: 256,
        compression: 'ZSTD',
        rowGroupSize: 500,
        partitionByCluster: true,
      })

      // 4 clusters, 100 vectors each
      const records: VectorRecord[] = []
      for (let clusterId = 0; clusterId < 4; clusterId++) {
        for (let i = 0; i < 100; i++) {
          records.push({
            id: `cluster${clusterId}_vec${i}`,
            clusterId,
            vector: generateRandomVector(256, clusterId * 1000 + i),
          })
        }
      }

      const result = await writer.write(records)

      // Read only cluster 2
      const clusterVectors = await writer.readByCluster(result.data, 2)

      expect(clusterVectors.length).toBe(100)
      for (const vec of clusterVectors) {
        expect(vec.clusterId).toBe(2)
        expect(vec.id.startsWith('cluster2_')).toBe(true)
      }
    })
  })
})
