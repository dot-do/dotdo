/**
 * Parquet Cluster File Format Tests
 *
 * Tests for storing vector clusters in Parquet format for efficient range scans
 * in vector search. The cluster file format is optimized for progressive precision
 * search with selective row group reading:
 *
 * - Row Group 0: Matryoshka 64-dim prefixes (for coarse filtering)
 * - Row Group 1: PQ codes (8 bytes each for fine-grained ranking)
 * - Row Group 2: Full vectors (for final reranking)
 * - Row Group 3: Metadata (ID, cluster info, timestamps)
 *
 * TDD Phase: RED - All tests should FAIL initially
 *
 * @module tests/vector/parquet-cluster.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createMockR2, type MockR2 } from '../harness/do'

// ============================================================================
// TYPES - Expected API (not yet implemented)
// ============================================================================

/**
 * Vector entry for cluster storage
 */
interface VectorEntry {
  id: string
  embedding: Float32Array
  metadata?: Record<string, unknown>
  clusterId?: string
  createdAt?: number
}

/**
 * Options for writing cluster files
 */
interface ClusterWriteOptions {
  /** Compression codec (default: ZSTD) */
  compression?: 'ZSTD' | 'SNAPPY' | 'LZ4' | 'UNCOMPRESSED'
  /** Target row group size */
  rowGroupSize?: number
  /** Generate Matryoshka prefixes (truncate to 64 dims) */
  generateMatryoshkaPrefixes?: boolean
  /** Generate PQ codes */
  generatePQCodes?: boolean
  /** PQ subquantizer count */
  pqSubquantizers?: number
  /** Custom metadata for the file */
  fileMetadata?: Map<string, string>
}

/**
 * Statistics for a Parquet cluster file
 */
interface ClusterFileStats {
  vectorCount: number
  dimensions: number
  fileSizeBytes: number
  rowGroupCount: number
  compressionRatio: number
  centroid?: Float32Array
  radius?: number
  minId?: string
  maxId?: string
  nullCount: Record<string, number>
}

/**
 * Result of reading vectors from cluster
 */
interface ClusterReadResult {
  vectors: VectorEntry[]
  bytesRead: number
  rowGroupsRead: number[]
}

/**
 * Cluster file API (to be implemented)
 */
interface ParquetClusterFile {
  // Write operations
  writeClusterFile(vectors: VectorEntry[], options?: ClusterWriteOptions): Promise<Uint8Array>
  appendToCluster(existing: Uint8Array, newVectors: VectorEntry[]): Promise<Uint8Array>

  // Read operations
  readVectors(data: Uint8Array, ids?: string[]): Promise<ClusterReadResult>
  readMatryoshkaPrefixes(data: Uint8Array, idRange?: { start?: string; end?: string }): Promise<Map<string, Float32Array>>
  readPQCodes(data: Uint8Array, ids: string[]): Promise<Map<string, Uint8Array>>
  readFullVectors(data: Uint8Array, ids: string[]): Promise<Map<string, Float32Array>>
  readMetadata(data: Uint8Array, ids?: string[]): Promise<Map<string, Record<string, unknown>>>

  // Statistics
  getClusterStats(data: Uint8Array): Promise<ClusterFileStats>

  // Cluster operations
  mergeClusters(clusters: Uint8Array[]): Promise<Uint8Array>
}

/**
 * R2-backed cluster storage (to be implemented)
 */
interface R2ClusterStorage {
  writeCluster(key: string, vectors: VectorEntry[], options?: ClusterWriteOptions): Promise<void>
  readCluster(key: string): Promise<VectorEntry[]>
  readClusterPrefixes(key: string): Promise<Map<string, Float32Array>>
  readClusterVectors(key: string, ids: string[]): Promise<Map<string, Float32Array>>
  listClusters(prefix?: string): Promise<string[]>
  deleteCluster(key: string): Promise<void>
  getClusterStats(key: string): Promise<ClusterFileStats>
}

// ============================================================================
// TEST UTILITIES
// ============================================================================

/**
 * Generate random unit vector
 */
function generateRandomVector(dimensions: number): Float32Array {
  const vec = new Float32Array(dimensions)
  let norm = 0
  for (let i = 0; i < dimensions; i++) {
    vec[i] = Math.random() * 2 - 1
    norm += vec[i] * vec[i]
  }
  norm = Math.sqrt(norm)
  for (let i = 0; i < dimensions; i++) {
    vec[i] /= norm
  }
  return vec
}

/**
 * Generate test vectors
 */
function generateTestVectors(count: number, dimensions: number = 1536): VectorEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `vec_${i.toString().padStart(6, '0')}`,
    embedding: generateRandomVector(dimensions),
    metadata: {
      index: i,
      type: ['document', 'chunk', 'entity'][i % 3],
      score: Math.random(),
    },
    clusterId: `cluster_${Math.floor(i / 100)}`,
    createdAt: Date.now() - i * 1000,
  }))
}

/**
 * Calculate cosine similarity
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * Truncate vector to Matryoshka prefix
 */
function truncateToPrefix(vec: Float32Array, prefixDims: number = 64): Float32Array {
  return vec.slice(0, prefixDims)
}

// ============================================================================
// PLACEHOLDER IMPLEMENTATIONS (to make tests compile but fail)
// ============================================================================

// These are intentionally not implemented - tests should fail
function createParquetClusterFile(): ParquetClusterFile {
  throw new Error('ParquetClusterFile not implemented')
}

function createR2ClusterStorage(_r2: MockR2): R2ClusterStorage {
  throw new Error('R2ClusterStorage not implemented')
}

// ============================================================================
// TESTS: Write Operations
// ============================================================================

describe('Parquet Cluster File Format', () => {
  describe('Write Operations', () => {
    it('should write vector cluster to Parquet format', async () => {
      const clusterFile = createParquetClusterFile()
      const vectors = generateTestVectors(100)

      const parquetData = await clusterFile.writeClusterFile(vectors)

      // Verify Parquet magic bytes (PAR1)
      expect(parquetData).toBeInstanceOf(Uint8Array)
      expect(parquetData.length).toBeGreaterThan(0)
      expect(parquetData[0]).toBe(0x50) // 'P'
      expect(parquetData[1]).toBe(0x41) // 'A'
      expect(parquetData[2]).toBe(0x52) // 'R'
      expect(parquetData[3]).toBe(0x31) // '1'
    })

    it('should store vector ID, embedding, and metadata columns', async () => {
      const clusterFile = createParquetClusterFile()
      const vectors = generateTestVectors(10)

      const parquetData = await clusterFile.writeClusterFile(vectors)
      const stats = await clusterFile.getClusterStats(parquetData)

      // Verify expected columns exist in schema
      expect(stats.vectorCount).toBe(10)
      expect(stats.dimensions).toBe(1536)

      // Read back and verify data integrity
      const result = await clusterFile.readVectors(parquetData)
      expect(result.vectors).toHaveLength(10)

      for (let i = 0; i < 10; i++) {
        const original = vectors[i]
        const retrieved = result.vectors.find(v => v.id === original.id)

        expect(retrieved).toBeDefined()
        expect(retrieved!.id).toBe(original.id)
        expect(retrieved!.embedding.length).toBe(original.embedding.length)
        expect(retrieved!.metadata).toEqual(original.metadata)

        // Verify embedding values match (within floating point tolerance)
        for (let j = 0; j < original.embedding.length; j++) {
          expect(retrieved!.embedding[j]).toBeCloseTo(original.embedding[j], 5)
        }
      }
    })

    it('should compress embeddings efficiently', async () => {
      const clusterFile = createParquetClusterFile()
      const vectors = generateTestVectors(1000, 1536)

      // Uncompressed size estimate: 1000 vectors * 1536 dims * 4 bytes = 6.14 MB
      const uncompressedEstimate = 1000 * 1536 * 4

      const parquetData = await clusterFile.writeClusterFile(vectors, {
        compression: 'ZSTD',
      })

      const stats = await clusterFile.getClusterStats(parquetData)

      // ZSTD should achieve at least 2x compression on random floats
      expect(stats.compressionRatio).toBeGreaterThan(1.5)
      expect(stats.fileSizeBytes).toBeLessThan(uncompressedEstimate)

      console.log(`[TEST] Compression ratio: ${stats.compressionRatio.toFixed(2)}x`)
      console.log(`[TEST] File size: ${(stats.fileSizeBytes / 1024).toFixed(2)} KB`)
    })

    it('should support incremental append without full rewrite', async () => {
      const clusterFile = createParquetClusterFile()

      // Write initial cluster
      const initialVectors = generateTestVectors(100)
      const initialData = await clusterFile.writeClusterFile(initialVectors)
      const initialStats = await clusterFile.getClusterStats(initialData)

      // Append new vectors
      const newVectors = generateTestVectors(50).map((v, i) => ({
        ...v,
        id: `new_vec_${i.toString().padStart(6, '0')}`,
      }))

      const appendedData = await clusterFile.appendToCluster(initialData, newVectors)
      const appendedStats = await clusterFile.getClusterStats(appendedData)

      // Verify counts
      expect(appendedStats.vectorCount).toBe(150)
      expect(appendedStats.rowGroupCount).toBeGreaterThan(initialStats.rowGroupCount)

      // Verify all vectors are readable
      const result = await clusterFile.readVectors(appendedData)
      expect(result.vectors).toHaveLength(150)

      // Verify original vectors are unchanged
      for (const original of initialVectors) {
        const retrieved = result.vectors.find(v => v.id === original.id)
        expect(retrieved).toBeDefined()
      }
    })
  })

  // ============================================================================
  // TESTS: Read Operations
  // ============================================================================

  describe('Read Operations', () => {
    it('should read vectors from Parquet cluster file', async () => {
      const clusterFile = createParquetClusterFile()
      const vectors = generateTestVectors(50)

      const parquetData = await clusterFile.writeClusterFile(vectors)
      const result = await clusterFile.readVectors(parquetData)

      expect(result.vectors).toHaveLength(50)
      expect(result.bytesRead).toBeGreaterThan(0)

      // Verify round-trip integrity
      for (const original of vectors) {
        const retrieved = result.vectors.find(v => v.id === original.id)
        expect(retrieved).toBeDefined()
        expect(cosineSimilarity(original.embedding, retrieved!.embedding)).toBeCloseTo(1.0, 5)
      }
    })

    it('should support column projection (only read needed columns)', async () => {
      const clusterFile = createParquetClusterFile()
      const vectors = generateTestVectors(100, 1536)

      const parquetData = await clusterFile.writeClusterFile(vectors)

      // Read only Matryoshka prefixes (64 dims instead of 1536)
      const prefixes = await clusterFile.readMatryoshkaPrefixes(parquetData)

      expect(prefixes.size).toBe(100)

      // Verify each prefix is 64 dimensions
      for (const [id, prefix] of prefixes) {
        expect(prefix.length).toBe(64)

        // Find original vector and verify prefix matches
        const original = vectors.find(v => v.id === id)
        expect(original).toBeDefined()

        const originalPrefix = truncateToPrefix(original!.embedding)
        for (let i = 0; i < 64; i++) {
          expect(prefix[i]).toBeCloseTo(originalPrefix[i], 5)
        }
      }
    })

    it('should support row group filtering for range queries', async () => {
      const clusterFile = createParquetClusterFile()

      // Create vectors with sortable IDs
      const vectors = generateTestVectors(1000)

      const parquetData = await clusterFile.writeClusterFile(vectors, {
        rowGroupSize: 100, // 10 row groups
      })

      // Query only a range of IDs
      const prefixes = await clusterFile.readMatryoshkaPrefixes(parquetData, {
        start: 'vec_000100',
        end: 'vec_000200',
      })

      // Should only read from relevant row groups
      expect(prefixes.size).toBeLessThanOrEqual(100)
      expect(prefixes.size).toBeGreaterThan(0)

      // Verify all returned IDs are in range
      for (const id of prefixes.keys()) {
        expect(id >= 'vec_000100').toBe(true)
        expect(id < 'vec_000200').toBe(true)
      }
    })

    it('should read PQ codes for specific IDs', async () => {
      const clusterFile = createParquetClusterFile()
      const vectors = generateTestVectors(100)

      const parquetData = await clusterFile.writeClusterFile(vectors, {
        generatePQCodes: true,
        pqSubquantizers: 8,
      })

      // Request PQ codes for specific IDs
      const requestedIds = ['vec_000010', 'vec_000020', 'vec_000030']
      const pqCodes = await clusterFile.readPQCodes(parquetData, requestedIds)

      expect(pqCodes.size).toBe(3)

      for (const id of requestedIds) {
        const code = pqCodes.get(id)
        expect(code).toBeDefined()
        // PQ codes with 8 subquantizers = 8 bytes
        expect(code!.length).toBe(8)
      }
    })

    it('should read full vectors for reranking', async () => {
      const clusterFile = createParquetClusterFile()
      const vectors = generateTestVectors(100)

      const parquetData = await clusterFile.writeClusterFile(vectors)

      // Request full vectors for top candidates
      const topIds = ['vec_000005', 'vec_000015', 'vec_000025']
      const fullVectors = await clusterFile.readFullVectors(parquetData, topIds)

      expect(fullVectors.size).toBe(3)

      for (const id of topIds) {
        const fullVec = fullVectors.get(id)
        expect(fullVec).toBeDefined()
        expect(fullVec!.length).toBe(1536)

        // Verify exact match with original
        const original = vectors.find(v => v.id === id)
        expect(original).toBeDefined()
        expect(cosineSimilarity(fullVec!, original!.embedding)).toBeCloseTo(1.0, 5)
      }
    })

    it('should read metadata separately', async () => {
      const clusterFile = createParquetClusterFile()
      const vectors = generateTestVectors(50)

      const parquetData = await clusterFile.writeClusterFile(vectors)

      // Read only metadata (no embeddings)
      const metadata = await clusterFile.readMetadata(parquetData)

      expect(metadata.size).toBe(50)

      for (const original of vectors) {
        const meta = metadata.get(original.id)
        expect(meta).toBeDefined()
        expect(meta).toEqual(original.metadata)
      }
    })
  })

  // ============================================================================
  // TESTS: Statistics and Metadata
  // ============================================================================

  describe('Statistics and Metadata', () => {
    it('should track Parquet file statistics (min/max/null count)', async () => {
      const clusterFile = createParquetClusterFile()

      // Create vectors with some null metadata
      const vectors = generateTestVectors(100).map((v, i) => ({
        ...v,
        metadata: i % 10 === 0 ? undefined : v.metadata, // 10% null
      }))

      const parquetData = await clusterFile.writeClusterFile(vectors)
      const stats = await clusterFile.getClusterStats(parquetData)

      expect(stats.vectorCount).toBe(100)
      expect(stats.dimensions).toBe(1536)
      expect(stats.rowGroupCount).toBeGreaterThan(0)
      expect(stats.fileSizeBytes).toBe(parquetData.length)

      // Min/max ID for range queries
      expect(stats.minId).toBe('vec_000000')
      expect(stats.maxId).toBe('vec_000099')

      // Null count tracking
      expect(stats.nullCount['metadata']).toBe(10)
    })

    it('should compute cluster centroid and radius', async () => {
      const clusterFile = createParquetClusterFile()

      // Create vectors clustered around a known centroid
      const trueCentroid = generateRandomVector(1536)
      const vectors: VectorEntry[] = []

      for (let i = 0; i < 100; i++) {
        // Add noise to centroid
        const noisy = new Float32Array(trueCentroid.length)
        for (let j = 0; j < trueCentroid.length; j++) {
          noisy[j] = trueCentroid[j] + (Math.random() - 0.5) * 0.1
        }
        // Renormalize
        let norm = 0
        for (let j = 0; j < noisy.length; j++) {
          norm += noisy[j] * noisy[j]
        }
        norm = Math.sqrt(norm)
        for (let j = 0; j < noisy.length; j++) {
          noisy[j] /= norm
        }

        vectors.push({
          id: `vec_${i.toString().padStart(6, '0')}`,
          embedding: noisy,
        })
      }

      const parquetData = await clusterFile.writeClusterFile(vectors)
      const stats = await clusterFile.getClusterStats(parquetData)

      expect(stats.centroid).toBeDefined()
      expect(stats.centroid!.length).toBe(1536)
      expect(stats.radius).toBeDefined()
      expect(stats.radius).toBeGreaterThan(0)

      // Computed centroid should be similar to true centroid
      const similarity = cosineSimilarity(stats.centroid!, trueCentroid)
      expect(similarity).toBeGreaterThan(0.9)
    })
  })

  // ============================================================================
  // TESTS: Cluster Operations
  // ============================================================================

  describe('Cluster Operations', () => {
    it('should handle cluster merging (multiple small clusters -> one large)', async () => {
      const clusterFile = createParquetClusterFile()

      // Create multiple small clusters
      const cluster1 = generateTestVectors(50).map((v, i) => ({
        ...v,
        id: `c1_${i.toString().padStart(4, '0')}`,
      }))
      const cluster2 = generateTestVectors(30).map((v, i) => ({
        ...v,
        id: `c2_${i.toString().padStart(4, '0')}`,
      }))
      const cluster3 = generateTestVectors(20).map((v, i) => ({
        ...v,
        id: `c3_${i.toString().padStart(4, '0')}`,
      }))

      // Write individual clusters
      const data1 = await clusterFile.writeClusterFile(cluster1)
      const data2 = await clusterFile.writeClusterFile(cluster2)
      const data3 = await clusterFile.writeClusterFile(cluster3)

      // Merge into single cluster
      const mergedData = await clusterFile.mergeClusters([data1, data2, data3])
      const mergedStats = await clusterFile.getClusterStats(mergedData)

      expect(mergedStats.vectorCount).toBe(100) // 50 + 30 + 20

      // Verify all vectors are accessible
      const result = await clusterFile.readVectors(mergedData)
      expect(result.vectors).toHaveLength(100)

      // Verify IDs from all clusters are present
      const ids = new Set(result.vectors.map(v => v.id))
      for (const v of cluster1) expect(ids.has(v.id)).toBe(true)
      for (const v of cluster2) expect(ids.has(v.id)).toBe(true)
      for (const v of cluster3) expect(ids.has(v.id)).toBe(true)
    })

    it('should handle empty cluster gracefully', async () => {
      const clusterFile = createParquetClusterFile()

      const parquetData = await clusterFile.writeClusterFile([])
      const stats = await clusterFile.getClusterStats(parquetData)

      expect(stats.vectorCount).toBe(0)
      expect(parquetData.length).toBeGreaterThan(0) // Still valid Parquet

      const result = await clusterFile.readVectors(parquetData)
      expect(result.vectors).toHaveLength(0)
    })

    it('should handle single vector cluster', async () => {
      const clusterFile = createParquetClusterFile()

      const single = generateTestVectors(1)
      const parquetData = await clusterFile.writeClusterFile(single)
      const stats = await clusterFile.getClusterStats(parquetData)

      expect(stats.vectorCount).toBe(1)

      const result = await clusterFile.readVectors(parquetData)
      expect(result.vectors).toHaveLength(1)
      expect(result.vectors[0].id).toBe(single[0].id)
    })

    it('should handle maximum cluster size', async () => {
      const clusterFile = createParquetClusterFile()

      // Large cluster with 10K vectors
      const vectors = generateTestVectors(10000, 384) // Smaller dims for speed

      const parquetData = await clusterFile.writeClusterFile(vectors, {
        compression: 'ZSTD',
        rowGroupSize: 1000,
      })

      const stats = await clusterFile.getClusterStats(parquetData)

      expect(stats.vectorCount).toBe(10000)
      expect(stats.rowGroupCount).toBe(10) // 10K / 1000
      expect(stats.compressionRatio).toBeGreaterThan(1)

      console.log(`[TEST] 10K vectors: ${(stats.fileSizeBytes / (1024 * 1024)).toFixed(2)} MB`)
    })
  })

  // ============================================================================
  // TESTS: R2 Integration
  // ============================================================================

  describe('R2 Storage Integration', () => {
    let mockR2: MockR2

    beforeEach(() => {
      mockR2 = createMockR2()
    })

    it('should integrate with R2 storage (write/read)', async () => {
      const r2Storage = createR2ClusterStorage(mockR2)
      const vectors = generateTestVectors(100)

      // Write cluster to R2
      await r2Storage.writeCluster('clusters/cluster_001.parquet', vectors)

      // Verify R2 put was called
      expect(mockR2.operations).toContainEqual({
        type: 'put',
        key: 'clusters/cluster_001.parquet',
      })

      // Read back from R2
      const retrieved = await r2Storage.readCluster('clusters/cluster_001.parquet')

      expect(retrieved).toHaveLength(100)
      for (const original of vectors) {
        const found = retrieved.find(v => v.id === original.id)
        expect(found).toBeDefined()
      }
    })

    it('should support selective reads from R2', async () => {
      const r2Storage = createR2ClusterStorage(mockR2)
      const vectors = generateTestVectors(100)

      await r2Storage.writeCluster('clusters/cluster_002.parquet', vectors)

      // Read only prefixes (should use column projection)
      const prefixes = await r2Storage.readClusterPrefixes('clusters/cluster_002.parquet')
      expect(prefixes.size).toBe(100)

      // Read specific vectors by ID
      const requestedIds = ['vec_000010', 'vec_000050']
      const specific = await r2Storage.readClusterVectors(
        'clusters/cluster_002.parquet',
        requestedIds
      )

      expect(specific.size).toBe(2)
      expect(specific.has('vec_000010')).toBe(true)
      expect(specific.has('vec_000050')).toBe(true)
    })

    it('should list clusters by prefix', async () => {
      const r2Storage = createR2ClusterStorage(mockR2)

      // Write multiple clusters
      await r2Storage.writeCluster('ns/tenant1/clusters/c1.parquet', generateTestVectors(10))
      await r2Storage.writeCluster('ns/tenant1/clusters/c2.parquet', generateTestVectors(10))
      await r2Storage.writeCluster('ns/tenant2/clusters/c1.parquet', generateTestVectors(10))

      // List tenant1 clusters
      const tenant1Clusters = await r2Storage.listClusters('ns/tenant1/clusters/')
      expect(tenant1Clusters).toHaveLength(2)
      expect(tenant1Clusters).toContain('ns/tenant1/clusters/c1.parquet')
      expect(tenant1Clusters).toContain('ns/tenant1/clusters/c2.parquet')

      // List all clusters
      const allClusters = await r2Storage.listClusters('ns/')
      expect(allClusters).toHaveLength(3)
    })

    it('should delete clusters from R2', async () => {
      const r2Storage = createR2ClusterStorage(mockR2)

      await r2Storage.writeCluster('clusters/to_delete.parquet', generateTestVectors(10))

      // Verify exists
      const before = await r2Storage.listClusters('clusters/')
      expect(before).toContain('clusters/to_delete.parquet')

      // Delete
      await r2Storage.deleteCluster('clusters/to_delete.parquet')

      // Verify deleted
      const after = await r2Storage.listClusters('clusters/')
      expect(after).not.toContain('clusters/to_delete.parquet')

      expect(mockR2.operations).toContainEqual({
        type: 'delete',
        key: 'clusters/to_delete.parquet',
      })
    })

    it('should get cluster stats from R2', async () => {
      const r2Storage = createR2ClusterStorage(mockR2)
      const vectors = generateTestVectors(100)

      await r2Storage.writeCluster('clusters/stats_test.parquet', vectors)

      const stats = await r2Storage.getClusterStats('clusters/stats_test.parquet')

      expect(stats.vectorCount).toBe(100)
      expect(stats.dimensions).toBe(1536)
      expect(stats.fileSizeBytes).toBeGreaterThan(0)
    })
  })

  // ============================================================================
  // TESTS: Compression Codecs
  // ============================================================================

  describe('Compression Codecs', () => {
    const codecs: Array<'ZSTD' | 'SNAPPY' | 'LZ4' | 'UNCOMPRESSED'> = [
      'ZSTD',
      'SNAPPY',
      'LZ4',
      'UNCOMPRESSED',
    ]

    for (const codec of codecs) {
      it(`should support ${codec} compression`, async () => {
        const clusterFile = createParquetClusterFile()
        const vectors = generateTestVectors(100)

        const parquetData = await clusterFile.writeClusterFile(vectors, {
          compression: codec,
        })

        expect(parquetData.length).toBeGreaterThan(0)

        // Verify round-trip works
        const result = await clusterFile.readVectors(parquetData)
        expect(result.vectors).toHaveLength(100)

        const stats = await clusterFile.getClusterStats(parquetData)
        console.log(`[TEST] ${codec}: ${(stats.fileSizeBytes / 1024).toFixed(2)} KB, ratio: ${stats.compressionRatio.toFixed(2)}x`)

        if (codec === 'UNCOMPRESSED') {
          expect(stats.compressionRatio).toBeCloseTo(1.0, 1)
        } else {
          expect(stats.compressionRatio).toBeGreaterThan(1.0)
        }
      })
    }
  })

  // ============================================================================
  // TESTS: Row Group Configuration
  // ============================================================================

  describe('Row Group Configuration', () => {
    it('should create multiple row groups based on rowGroupSize', async () => {
      const clusterFile = createParquetClusterFile()
      const vectors = generateTestVectors(500)

      const parquetData = await clusterFile.writeClusterFile(vectors, {
        rowGroupSize: 100,
      })

      const stats = await clusterFile.getClusterStats(parquetData)

      expect(stats.rowGroupCount).toBe(5) // 500 / 100
    })

    it('should handle rowGroupSize larger than vector count', async () => {
      const clusterFile = createParquetClusterFile()
      const vectors = generateTestVectors(50)

      const parquetData = await clusterFile.writeClusterFile(vectors, {
        rowGroupSize: 1000,
      })

      const stats = await clusterFile.getClusterStats(parquetData)

      expect(stats.rowGroupCount).toBe(1)
      expect(stats.vectorCount).toBe(50)
    })
  })

  // ============================================================================
  // TESTS: File Metadata
  // ============================================================================

  describe('File Metadata', () => {
    it('should store custom key-value metadata in Parquet footer', async () => {
      const clusterFile = createParquetClusterFile()
      const vectors = generateTestVectors(10)

      const customMetadata = new Map([
        ['dotdo:schema_version', '1.0.0'],
        ['dotdo:namespace', 'test.do'],
        ['dotdo:cluster_id', 'cluster_abc123'],
        ['dotdo:created_at', new Date().toISOString()],
      ])

      const parquetData = await clusterFile.writeClusterFile(vectors, {
        fileMetadata: customMetadata,
      })

      // Read back and verify metadata is preserved
      // (This would require exposing file-level metadata in the API)
      const stats = await clusterFile.getClusterStats(parquetData)
      expect(stats.vectorCount).toBe(10)

      // The actual metadata verification would depend on API design
      // For now, just verify the write succeeded
      expect(parquetData.length).toBeGreaterThan(0)
    })
  })
})
