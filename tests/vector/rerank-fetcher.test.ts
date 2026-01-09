/**
 * Rerank Fetcher Tests (R2 Parquet reader for final reranking)
 *
 * TDD RED phase tests for the rerank fetcher that loads full vectors from R2 Parquet
 * files for final exact-distance reranking. This is the final stage of the static
 * assets vector search architecture where approximate candidates are reranked using
 * exact distances.
 *
 * Key responsibilities:
 * - Fetch specific vector IDs from R2 Parquet files
 * - Use row group statistics for efficient reads (predicate pushdown)
 * - Batch fetch multiple IDs in single R2 request
 * - Compute exact cosine similarity for fetched vectors
 * - Compute exact L2 distance for fetched vectors
 * - Rerank candidates by exact distance
 * - Return final top-K with exact scores
 * - Handle missing IDs gracefully
 * - Minimize R2 subrequests through batch reads
 * - Handle Parquet files partitioned by cluster
 *
 * Reference: docs/plans/static-assets-vector-search.md
 *
 * @module tests/vector/rerank-fetcher.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createMockR2, type MockR2 } from '../harness/do'

// Import the rerank fetcher (does not exist yet - RED phase)
import {
  RerankFetcher,
  createRerankFetcher,
  type RerankCandidate,
  type RerankResult,
  type RerankConfig,
  type FetchStats,
  type DistanceMetric,
} from '../../db/vector/rerank-fetcher'

// ============================================================================
// TEST UTILITIES
// ============================================================================

/**
 * Generate a random unit vector (normalized)
 */
function generateRandomVector(dimensions: number, seed: number = 0): Float32Array {
  const vec = new Float32Array(dimensions)
  let norm = 0
  // Use deterministic pseudo-random for reproducibility
  let s = seed
  for (let i = 0; i < dimensions; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    vec[i] = (s / 0x7fffffff) * 2 - 1
    norm += vec[i] * vec[i]
  }
  norm = Math.sqrt(norm)
  for (let i = 0; i < dimensions; i++) {
    vec[i] /= norm
  }
  return vec
}

/**
 * Compute cosine similarity between two vectors
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
 * Compute L2 (Euclidean) distance between two vectors
 */
function l2Distance(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i]
    sum += diff * diff
  }
  return Math.sqrt(sum)
}

/**
 * Create a mock Parquet file buffer with embedded vectors
 * (In practice, this would be real Parquet data)
 */
function createMockParquetData(
  vectors: Array<{ id: string; embedding: Float32Array; clusterId?: string }>,
  options?: { rowGroupSize?: number }
): Uint8Array {
  // Create a minimal mock structure representing Parquet layout
  // The actual implementation will use real Parquet parsing
  const metadata = {
    vectorCount: vectors.length,
    rowGroupSize: options?.rowGroupSize ?? 1000,
    vectors: vectors.map(v => ({
      id: v.id,
      embedding: Array.from(v.embedding),
      clusterId: v.clusterId ?? 'default',
    })),
  }
  const jsonStr = JSON.stringify(metadata)
  const encoder = new TextEncoder()
  const data = encoder.encode(jsonStr)

  // Add PAR1 magic bytes for identification
  const result = new Uint8Array(4 + data.length + 4)
  result[0] = 0x50 // P
  result[1] = 0x41 // A
  result[2] = 0x52 // R
  result[3] = 0x31 // 1
  result.set(data, 4)
  result.set([0x50, 0x41, 0x52, 0x31], 4 + data.length) // Footer magic

  return result
}

/**
 * Create test vectors with IDs
 */
function createTestVectors(
  count: number,
  options?: {
    dimensions?: number
    prefix?: string
    clusterId?: string
  }
): Array<{ id: string; embedding: Float32Array; clusterId?: string }> {
  const { dimensions = 1536, prefix = 'vec', clusterId } = options ?? {}

  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}_${i.toString().padStart(6, '0')}`,
    embedding: generateRandomVector(dimensions, i),
    clusterId: clusterId ?? `cluster_${Math.floor(i / 100)}`,
  }))
}

/**
 * Create test candidates (from coarse search)
 */
function createTestCandidates(
  ids: string[],
  options?: { approximateScores?: number[] }
): RerankCandidate[] {
  return ids.map((id, i) => ({
    id,
    approximateScore: options?.approximateScores?.[i] ?? 0.9 - i * 0.01,
    clusterId: `cluster_${Math.floor(i / 10)}`,
  }))
}

/**
 * Setup mock R2 with Parquet cluster files
 */
function setupMockR2WithClusters(
  mockR2: MockR2,
  clusterData: Map<string, Array<{ id: string; embedding: Float32Array }>>
): void {
  for (const [clusterId, vectors] of clusterData) {
    const parquetPath = `vectors/cluster-${clusterId.padStart(4, '0')}.parquet`
    const parquetData = createMockParquetData(
      vectors.map(v => ({ ...v, clusterId }))
    )
    mockR2.data.set(parquetPath, parquetData)
  }
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('RerankFetcher', () => {
  let mockR2: MockR2
  let fetcher: RerankFetcher

  beforeEach(() => {
    mockR2 = {
      data: new Map(),
      operations: [],
      async put(key: string, value: unknown) {
        this.operations.push({ type: 'put', key })
        this.data.set(key, value)
      },
      async get(key: string) {
        this.operations.push({ type: 'get', key })
        const data = this.data.get(key)
        if (!data) return null
        return {
          body: data,
          arrayBuffer: async () => data,
          text: async () => new TextDecoder().decode(data as Uint8Array),
        }
      },
      async delete(key: string) {
        this.operations.push({ type: 'delete', key })
        this.data.delete(key)
      },
      async list(options?: { prefix?: string }) {
        this.operations.push({ type: 'list', key: options?.prefix })
        const objects: Array<{ key: string }> = []
        for (const key of this.data.keys()) {
          if (!options?.prefix || key.startsWith(options.prefix)) {
            objects.push({ key })
          }
        }
        return { objects }
      },
    }

    fetcher = createRerankFetcher({
      r2: mockR2 as unknown as R2Bucket,
      vectorPrefix: 'vectors/',
      dimensions: 1536,
    })
  })

  // ==========================================================================
  // TEST 1: Fetch specific vector IDs from R2 Parquet
  // ==========================================================================

  describe('should fetch specific vector IDs from R2 Parquet', () => {
    it('fetches a single vector by ID', async () => {
      // Arrange: Create cluster with vectors
      const vectors = createTestVectors(100)
      const parquetData = createMockParquetData(vectors)
      mockR2.data.set('vectors/cluster-0000.parquet', parquetData)

      const targetId = 'vec_000042'

      // Act
      const result = await fetcher.fetchVectors([targetId])

      // Assert
      expect(result.vectors.size).toBe(1)
      expect(result.vectors.has(targetId)).toBe(true)

      const fetchedVec = result.vectors.get(targetId)!
      expect(fetchedVec.length).toBe(1536)

      // Verify the vector matches the original
      const originalVec = vectors.find(v => v.id === targetId)!
      for (let i = 0; i < 1536; i++) {
        expect(fetchedVec[i]).toBeCloseTo(originalVec.embedding[i], 5)
      }
    })

    it('fetches multiple vectors by ID list', async () => {
      // Arrange
      const vectors = createTestVectors(100)
      const parquetData = createMockParquetData(vectors)
      mockR2.data.set('vectors/cluster-0000.parquet', parquetData)

      const targetIds = ['vec_000010', 'vec_000025', 'vec_000050', 'vec_000075']

      // Act
      const result = await fetcher.fetchVectors(targetIds)

      // Assert
      expect(result.vectors.size).toBe(4)
      for (const id of targetIds) {
        expect(result.vectors.has(id)).toBe(true)
        expect(result.vectors.get(id)!.length).toBe(1536)
      }
    })

    it('returns only requested vectors, not entire file', async () => {
      // Arrange: Large file with 10K vectors
      const vectors = createTestVectors(10000)
      const parquetData = createMockParquetData(vectors)
      mockR2.data.set('vectors/cluster-0000.parquet', parquetData)

      const targetIds = ['vec_000001', 'vec_000002', 'vec_000003']

      // Act
      const result = await fetcher.fetchVectors(targetIds)

      // Assert: Only 3 vectors returned, not 10K
      expect(result.vectors.size).toBe(3)
      expect(result.stats.vectorsFetched).toBe(3)
    })

    it('fetches vectors from correct cluster file path', async () => {
      // Arrange
      const vectors = createTestVectors(50, { clusterId: '0042' })
      const parquetData = createMockParquetData(vectors)
      mockR2.data.set('vectors/cluster-0042.parquet', parquetData)

      // Act
      await fetcher.fetchVectorsFromCluster('0042', ['vec_000010'])

      // Assert: Correct file was accessed
      const getOps = mockR2.operations.filter(op => op.type === 'get')
      expect(getOps).toContainEqual({ type: 'get', key: 'vectors/cluster-0042.parquet' })
    })
  })

  // ==========================================================================
  // TEST 2: Use row group statistics for efficient reads
  // ==========================================================================

  describe('should use row group statistics for efficient reads', () => {
    it('skips row groups that cannot contain requested IDs', async () => {
      // Arrange: Create Parquet with multiple row groups, sorted by ID
      const vectors = createTestVectors(1000, { dimensions: 384 })
      const parquetData = createMockParquetData(vectors, { rowGroupSize: 100 })
      mockR2.data.set('vectors/cluster-0000.parquet', parquetData)

      // Request IDs from one row group only (IDs 500-510)
      const targetIds = ['vec_000500', 'vec_000505', 'vec_000510']

      // Act
      const result = await fetcher.fetchVectors(targetIds)

      // Assert: Only relevant row groups were read
      expect(result.stats.rowGroupsScanned).toBeLessThan(10) // Not all 10 row groups
      expect(result.stats.rowGroupsSkipped).toBeGreaterThan(0)
      expect(result.vectors.size).toBe(3)
    })

    it('uses min/max statistics from row group metadata', async () => {
      // Arrange
      const vectors = createTestVectors(500)
      const parquetData = createMockParquetData(vectors, { rowGroupSize: 50 })
      mockR2.data.set('vectors/cluster-0000.parquet', parquetData)

      // Request IDs at known row group boundaries
      const targetIds = ['vec_000025'] // Should be in first row group

      // Act
      const result = await fetcher.fetchVectors(targetIds)

      // Assert
      expect(result.stats.rowGroupsScanned).toBe(1)
      expect(result.stats.rowGroupsSkipped).toBe(9) // 10 groups total, only 1 scanned
    })

    it('reads multiple row groups when IDs span groups', async () => {
      // Arrange
      const vectors = createTestVectors(500)
      const parquetData = createMockParquetData(vectors, { rowGroupSize: 50 })
      mockR2.data.set('vectors/cluster-0000.parquet', parquetData)

      // Request IDs from different row groups
      const targetIds = ['vec_000025', 'vec_000125', 'vec_000225']

      // Act
      const result = await fetcher.fetchVectors(targetIds)

      // Assert
      expect(result.stats.rowGroupsScanned).toBe(3)
      expect(result.vectors.size).toBe(3)
    })

    it('reports bytes read vs total file size', async () => {
      // Arrange: Large file
      const vectors = createTestVectors(1000, { dimensions: 1536 })
      const parquetData = createMockParquetData(vectors, { rowGroupSize: 100 })
      mockR2.data.set('vectors/cluster-0000.parquet', parquetData)

      // Request small subset
      const targetIds = ['vec_000050']

      // Act
      const result = await fetcher.fetchVectors(targetIds)

      // Assert: Should read much less than total file
      expect(result.stats.bytesRead).toBeLessThan(result.stats.totalFileSize)
      expect(result.stats.bytesRead).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // TEST 3: Batch fetch multiple IDs in single request
  // ==========================================================================

  describe('should batch fetch multiple IDs in single request', () => {
    it('combines multiple ID requests into single R2 read', async () => {
      // Arrange
      const vectors = createTestVectors(100)
      const parquetData = createMockParquetData(vectors)
      mockR2.data.set('vectors/cluster-0000.parquet', parquetData)

      const targetIds = ['vec_000010', 'vec_000020', 'vec_000030', 'vec_000040']

      // Act
      const result = await fetcher.fetchVectors(targetIds)

      // Assert: Only one R2 read operation for the cluster
      const getOps = mockR2.operations.filter(op => op.type === 'get')
      expect(getOps.length).toBe(1)
      expect(result.vectors.size).toBe(4)
    })

    it('batches requests per cluster file', async () => {
      // Arrange: Vectors spread across multiple cluster files
      const cluster0Vectors = createTestVectors(50, { prefix: 'c0', clusterId: '0000' })
      const cluster1Vectors = createTestVectors(50, { prefix: 'c1', clusterId: '0001' })

      mockR2.data.set('vectors/cluster-0000.parquet', createMockParquetData(cluster0Vectors))
      mockR2.data.set('vectors/cluster-0001.parquet', createMockParquetData(cluster1Vectors))

      const candidates = [
        ...createTestCandidates(['c0_000010', 'c0_000020']).map(c => ({ ...c, clusterId: '0000' })),
        ...createTestCandidates(['c1_000030', 'c1_000040']).map(c => ({ ...c, clusterId: '0001' })),
      ]

      // Act
      const result = await fetcher.fetchCandidateVectors(candidates)

      // Assert: One read per cluster (2 total), not per ID (4)
      const getOps = mockR2.operations.filter(op => op.type === 'get')
      expect(getOps.length).toBe(2)
      expect(result.vectors.size).toBe(4)
    })

    it('respects maximum batch size configuration', async () => {
      // Arrange
      const vectors = createTestVectors(200)
      const parquetData = createMockParquetData(vectors)
      mockR2.data.set('vectors/cluster-0000.parquet', parquetData)

      const customFetcher = createRerankFetcher({
        r2: mockR2 as unknown as R2Bucket,
        vectorPrefix: 'vectors/',
        dimensions: 1536,
        maxBatchSize: 50, // Small batch size
      })

      const targetIds = Array.from({ length: 100 }, (_, i) => `vec_${i.toString().padStart(6, '0')}`)

      // Act
      const result = await customFetcher.fetchVectors(targetIds)

      // Assert: Multiple reads due to batch size limit
      expect(result.stats.batchCount).toBe(2) // 100 IDs / 50 batch size
      expect(result.vectors.size).toBe(100)
    })

    it('processes batches in parallel where possible', async () => {
      // Arrange: Multiple cluster files
      const clusterData = new Map<string, Array<{ id: string; embedding: Float32Array }>>()
      for (let c = 0; c < 5; c++) {
        const clusterId = c.toString().padStart(4, '0')
        clusterData.set(clusterId, createTestVectors(50, { prefix: `c${c}`, clusterId }))
      }
      setupMockR2WithClusters(mockR2, clusterData)

      const candidates = Array.from({ length: 50 }, (_, i) => ({
        id: `c${i % 5}_${(i * 2).toString().padStart(6, '0')}`,
        approximateScore: 0.9,
        clusterId: (i % 5).toString().padStart(4, '0'),
      }))

      // Act
      const startTime = performance.now()
      const result = await fetcher.fetchCandidateVectors(candidates)
      const elapsed = performance.now() - startTime

      // Assert: All 5 clusters should be fetched in parallel
      expect(result.vectors.size).toBeGreaterThan(0)
      expect(result.stats.parallelFetches).toBe(5)
    })
  })

  // ==========================================================================
  // TEST 4: Compute exact cosine similarity for fetched vectors
  // ==========================================================================

  describe('should compute exact cosine similarity for fetched vectors', () => {
    it('computes cosine similarity between query and fetched vectors', async () => {
      // Arrange
      const vectors = createTestVectors(10)
      const parquetData = createMockParquetData(vectors)
      mockR2.data.set('vectors/cluster-0000.parquet', parquetData)

      const query = generateRandomVector(1536, 999)
      const targetIds = ['vec_000000', 'vec_000001', 'vec_000002']

      // Act
      const result = await fetcher.rerankByCosine(query, targetIds)

      // Assert
      expect(result.results.length).toBe(3)
      for (const r of result.results) {
        // Cosine similarity should be between -1 and 1
        expect(r.exactScore).toBeGreaterThanOrEqual(-1)
        expect(r.exactScore).toBeLessThanOrEqual(1)
      }
    })

    it('returns results sorted by cosine similarity (descending)', async () => {
      // Arrange
      const vectors = createTestVectors(20)
      const parquetData = createMockParquetData(vectors)
      mockR2.data.set('vectors/cluster-0000.parquet', parquetData)

      const query = generateRandomVector(1536, 42)
      const targetIds = vectors.map(v => v.id)

      // Act
      const result = await fetcher.rerankByCosine(query, targetIds)

      // Assert: Results sorted by score descending
      for (let i = 0; i < result.results.length - 1; i++) {
        expect(result.results[i].exactScore).toBeGreaterThanOrEqual(result.results[i + 1].exactScore)
      }
    })

    it('matches manual cosine similarity computation', async () => {
      // Arrange
      const vectors = createTestVectors(5)
      const parquetData = createMockParquetData(vectors)
      mockR2.data.set('vectors/cluster-0000.parquet', parquetData)

      const query = generateRandomVector(1536, 123)
      const targetId = 'vec_000000'

      // Act
      const result = await fetcher.rerankByCosine(query, [targetId])

      // Assert: Match manual computation
      const originalVec = vectors[0].embedding
      const expectedSimilarity = cosineSimilarity(query, originalVec)

      expect(result.results[0].exactScore).toBeCloseTo(expectedSimilarity, 5)
    })

    it('handles normalized vectors correctly', async () => {
      // Arrange: All test vectors are already normalized
      const vectors = createTestVectors(10)
      const parquetData = createMockParquetData(vectors)
      mockR2.data.set('vectors/cluster-0000.parquet', parquetData)

      const query = generateRandomVector(1536, 777) // Also normalized
      const targetIds = vectors.map(v => v.id)

      // Act
      const result = await fetcher.rerankByCosine(query, targetIds)

      // Assert: For normalized vectors, cosine similarity = dot product
      for (const r of result.results) {
        const vec = vectors.find(v => v.id === r.id)!.embedding
        const dotProduct = query.reduce((sum, q, i) => sum + q * vec[i], 0)
        expect(r.exactScore).toBeCloseTo(dotProduct, 4)
      }
    })
  })

  // ==========================================================================
  // TEST 5: Compute exact L2 distance for fetched vectors
  // ==========================================================================

  describe('should compute exact L2 distance for fetched vectors', () => {
    it('computes L2 (Euclidean) distance between query and fetched vectors', async () => {
      // Arrange
      const vectors = createTestVectors(10)
      const parquetData = createMockParquetData(vectors)
      mockR2.data.set('vectors/cluster-0000.parquet', parquetData)

      const query = generateRandomVector(1536, 999)
      const targetIds = ['vec_000000', 'vec_000001', 'vec_000002']

      // Act
      const result = await fetcher.rerankByL2(query, targetIds)

      // Assert
      expect(result.results.length).toBe(3)
      for (const r of result.results) {
        // L2 distance should be non-negative
        expect(r.exactScore).toBeGreaterThanOrEqual(0)
      }
    })

    it('returns results sorted by L2 distance (ascending)', async () => {
      // Arrange
      const vectors = createTestVectors(20)
      const parquetData = createMockParquetData(vectors)
      mockR2.data.set('vectors/cluster-0000.parquet', parquetData)

      const query = generateRandomVector(1536, 42)
      const targetIds = vectors.map(v => v.id)

      // Act
      const result = await fetcher.rerankByL2(query, targetIds)

      // Assert: Results sorted by distance ascending (smaller is better)
      for (let i = 0; i < result.results.length - 1; i++) {
        expect(result.results[i].exactScore).toBeLessThanOrEqual(result.results[i + 1].exactScore)
      }
    })

    it('matches manual L2 distance computation', async () => {
      // Arrange
      const vectors = createTestVectors(5)
      const parquetData = createMockParquetData(vectors)
      mockR2.data.set('vectors/cluster-0000.parquet', parquetData)

      const query = generateRandomVector(1536, 456)
      const targetId = 'vec_000002'

      // Act
      const result = await fetcher.rerankByL2(query, [targetId])

      // Assert: Match manual computation
      const originalVec = vectors[2].embedding
      const expectedDistance = l2Distance(query, originalVec)

      expect(result.results[0].exactScore).toBeCloseTo(expectedDistance, 5)
    })

    it('returns zero distance for identical vectors', async () => {
      // Arrange: Create vector that matches query
      const query = generateRandomVector(1536, 12345)
      const vectors = [
        { id: 'exact_match', embedding: new Float32Array(query) }, // Clone query
        ...createTestVectors(5),
      ]
      const parquetData = createMockParquetData(vectors)
      mockR2.data.set('vectors/cluster-0000.parquet', parquetData)

      // Act
      const result = await fetcher.rerankByL2(query, ['exact_match'])

      // Assert
      expect(result.results[0].exactScore).toBeCloseTo(0, 5)
    })
  })

  // ==========================================================================
  // TEST 6: Rerank candidates by exact distance
  // ==========================================================================

  describe('should rerank candidates by exact distance', () => {
    it('reranks approximate candidates using exact scores', async () => {
      // Arrange: Candidates with approximate scores that differ from exact
      const vectors = createTestVectors(20)
      const parquetData = createMockParquetData(vectors)
      mockR2.data.set('vectors/cluster-0000.parquet', parquetData)

      // Approximate scores in reverse order of IDs
      const candidates: RerankCandidate[] = vectors.map((v, i) => ({
        id: v.id,
        approximateScore: 0.99 - i * 0.01, // vec_000000 has highest approx score
        clusterId: '0000',
      }))

      const query = generateRandomVector(1536, 999)

      // Act
      const result = await fetcher.rerank(query, candidates, { metric: 'cosine' })

      // Assert: Order should be by exact score, not approximate
      const firstResultApprox = candidates.find(c => c.id === result.results[0].id)!.approximateScore
      const lastResultApprox = candidates.find(c => c.id === result.results[result.results.length - 1].id)!.approximateScore

      // The reranking should change the order (exact scores differ from approximate)
      expect(result.results[0].exactScore).toBeDefined()
      expect(result.orderChanged).toBe(true)
    })

    it('preserves original candidate metadata through reranking', async () => {
      // Arrange
      const vectors = createTestVectors(10)
      const parquetData = createMockParquetData(vectors)
      mockR2.data.set('vectors/cluster-0000.parquet', parquetData)

      const candidates: RerankCandidate[] = vectors.slice(0, 5).map((v, i) => ({
        id: v.id,
        approximateScore: 0.9 - i * 0.1,
        clusterId: '0000',
        metadata: { originalRank: i, source: 'pq-search' },
      }))

      const query = generateRandomVector(1536, 42)

      // Act
      const result = await fetcher.rerank(query, candidates, { metric: 'cosine' })

      // Assert: Metadata preserved
      for (const r of result.results) {
        expect(r.metadata).toBeDefined()
        expect(r.metadata?.source).toBe('pq-search')
        expect(typeof r.metadata?.originalRank).toBe('number')
      }
    })

    it('includes both approximate and exact scores in results', async () => {
      // Arrange
      const vectors = createTestVectors(5)
      const parquetData = createMockParquetData(vectors)
      mockR2.data.set('vectors/cluster-0000.parquet', parquetData)

      const candidates: RerankCandidate[] = vectors.map((v, i) => ({
        id: v.id,
        approximateScore: 0.5 + i * 0.1,
        clusterId: '0000',
      }))

      const query = generateRandomVector(1536, 123)

      // Act
      const result = await fetcher.rerank(query, candidates, { metric: 'cosine' })

      // Assert
      for (const r of result.results) {
        expect(r.approximateScore).toBeDefined()
        expect(r.exactScore).toBeDefined()
        expect(r.scoreImprovement).toBeDefined() // Difference between exact and approximate
      }
    })

    it('supports configurable distance metric', async () => {
      // Arrange
      const vectors = createTestVectors(10)
      const parquetData = createMockParquetData(vectors)
      mockR2.data.set('vectors/cluster-0000.parquet', parquetData)

      const candidates = createTestCandidates(vectors.map(v => v.id))
        .map(c => ({ ...c, clusterId: '0000' }))

      const query = generateRandomVector(1536, 789)

      // Act: Rerank with both metrics
      const cosineResult = await fetcher.rerank(query, candidates, { metric: 'cosine' })
      const l2Result = await fetcher.rerank(query, candidates, { metric: 'l2' })

      // Assert: Results should use appropriate metric
      expect(cosineResult.metric).toBe('cosine')
      expect(l2Result.metric).toBe('l2')

      // Cosine scores: higher is better (similarity)
      // L2 scores: lower is better (distance)
      // Orders may differ
      expect(cosineResult.results[0].id).not.toBe(l2Result.results[l2Result.results.length - 1].id)
    })
  })

  // ==========================================================================
  // TEST 7: Return final top-K with exact scores
  // ==========================================================================

  describe('should return final top-K with exact scores', () => {
    it('returns exactly K results when K < candidates', async () => {
      // Arrange
      const vectors = createTestVectors(100)
      const parquetData = createMockParquetData(vectors)
      mockR2.data.set('vectors/cluster-0000.parquet', parquetData)

      const candidates = createTestCandidates(vectors.map(v => v.id))
        .map(c => ({ ...c, clusterId: '0000' }))

      const query = generateRandomVector(1536, 42)
      const k = 10

      // Act
      const result = await fetcher.rerank(query, candidates, { metric: 'cosine', topK: k })

      // Assert
      expect(result.results.length).toBe(k)
    })

    it('returns all results when K > candidates', async () => {
      // Arrange
      const vectors = createTestVectors(5)
      const parquetData = createMockParquetData(vectors)
      mockR2.data.set('vectors/cluster-0000.parquet', parquetData)

      const candidates = createTestCandidates(vectors.map(v => v.id))
        .map(c => ({ ...c, clusterId: '0000' }))

      const query = generateRandomVector(1536, 42)
      const k = 100 // More than available

      // Act
      const result = await fetcher.rerank(query, candidates, { metric: 'cosine', topK: k })

      // Assert
      expect(result.results.length).toBe(5) // All available
    })

    it('returns best K results based on exact scores', async () => {
      // Arrange
      const vectors = createTestVectors(50)
      const parquetData = createMockParquetData(vectors)
      mockR2.data.set('vectors/cluster-0000.parquet', parquetData)

      const candidates = createTestCandidates(vectors.map(v => v.id))
        .map(c => ({ ...c, clusterId: '0000' }))

      const query = generateRandomVector(1536, 42)
      const k = 10

      // Act
      const result = await fetcher.rerank(query, candidates, { metric: 'cosine', topK: k })

      // Assert: Top K should have highest exact scores
      const allExactScores = result.results.map(r => r.exactScore)
      const sortedScores = [...allExactScores].sort((a, b) => b - a)

      // Results should be sorted
      expect(allExactScores).toEqual(sortedScores)
    })

    it('reports filtering statistics', async () => {
      // Arrange
      const vectors = createTestVectors(100)
      const parquetData = createMockParquetData(vectors)
      mockR2.data.set('vectors/cluster-0000.parquet', parquetData)

      const candidates = createTestCandidates(vectors.map(v => v.id))
        .map(c => ({ ...c, clusterId: '0000' }))

      const query = generateRandomVector(1536, 42)
      const k = 10

      // Act
      const result = await fetcher.rerank(query, candidates, { metric: 'cosine', topK: k })

      // Assert
      expect(result.totalCandidates).toBe(100)
      expect(result.results.length).toBe(k)
      expect(result.stats.candidatesFiltered).toBe(90) // 100 - 10
    })
  })

  // ==========================================================================
  // TEST 8: Handle missing IDs gracefully
  // ==========================================================================

  describe('should handle missing IDs gracefully', () => {
    it('returns partial results when some IDs not found', async () => {
      // Arrange
      const vectors = createTestVectors(50)
      const parquetData = createMockParquetData(vectors)
      mockR2.data.set('vectors/cluster-0000.parquet', parquetData)

      // Mix of valid and invalid IDs
      const targetIds = [
        'vec_000010', // valid
        'vec_999999', // invalid
        'vec_000020', // valid
        'nonexistent', // invalid
      ]

      // Act
      const result = await fetcher.fetchVectors(targetIds)

      // Assert
      expect(result.vectors.size).toBe(2) // Only valid IDs
      expect(result.vectors.has('vec_000010')).toBe(true)
      expect(result.vectors.has('vec_000020')).toBe(true)
      expect(result.vectors.has('vec_999999')).toBe(false)
      expect(result.vectors.has('nonexistent')).toBe(false)
    })

    it('reports missing IDs in result metadata', async () => {
      // Arrange
      const vectors = createTestVectors(50)
      const parquetData = createMockParquetData(vectors)
      mockR2.data.set('vectors/cluster-0000.parquet', parquetData)

      const targetIds = ['vec_000010', 'missing_1', 'vec_000020', 'missing_2']

      // Act
      const result = await fetcher.fetchVectors(targetIds)

      // Assert
      expect(result.missingIds).toBeDefined()
      expect(result.missingIds).toContain('missing_1')
      expect(result.missingIds).toContain('missing_2')
      expect(result.missingIds).toHaveLength(2)
    })

    it('returns empty result when all IDs missing', async () => {
      // Arrange
      const vectors = createTestVectors(10)
      const parquetData = createMockParquetData(vectors)
      mockR2.data.set('vectors/cluster-0000.parquet', parquetData)

      const targetIds = ['invalid_1', 'invalid_2', 'invalid_3']

      // Act
      const result = await fetcher.fetchVectors(targetIds)

      // Assert
      expect(result.vectors.size).toBe(0)
      expect(result.missingIds).toEqual(targetIds)
    })

    it('handles missing cluster file gracefully', async () => {
      // Arrange: No cluster file exists
      const targetIds = ['vec_000010']

      // Act
      const result = await fetcher.fetchVectorsFromCluster('9999', targetIds)

      // Assert
      expect(result.vectors.size).toBe(0)
      expect(result.errors).toBeDefined()
      expect(result.errors![0].type).toBe('cluster_not_found')
      expect(result.errors![0].clusterId).toBe('9999')
    })

    it('excludes missing IDs from reranking without error', async () => {
      // Arrange
      const vectors = createTestVectors(20)
      const parquetData = createMockParquetData(vectors)
      mockR2.data.set('vectors/cluster-0000.parquet', parquetData)

      const candidates: RerankCandidate[] = [
        ...vectors.slice(0, 5).map((v, i) => ({
          id: v.id,
          approximateScore: 0.9 - i * 0.1,
          clusterId: '0000',
        })),
        // Add some missing candidates
        { id: 'missing_1', approximateScore: 0.99, clusterId: '0000' },
        { id: 'missing_2', approximateScore: 0.98, clusterId: '0000' },
      ]

      const query = generateRandomVector(1536, 42)

      // Act
      const result = await fetcher.rerank(query, candidates, { metric: 'cosine' })

      // Assert: Only valid candidates in results
      expect(result.results.length).toBe(5)
      expect(result.skippedCandidates).toBe(2)
      expect(result.skippedIds).toContain('missing_1')
      expect(result.skippedIds).toContain('missing_2')
    })
  })

  // ==========================================================================
  // TEST 9: Minimize R2 subrequests (batch reads)
  // ==========================================================================

  describe('should minimize R2 subrequests (batch reads)', () => {
    it('groups IDs by cluster to minimize R2 calls', async () => {
      // Arrange: Multiple clusters
      const cluster0 = createTestVectors(50, { prefix: 'c0', clusterId: '0000' })
      const cluster1 = createTestVectors(50, { prefix: 'c1', clusterId: '0001' })
      const cluster2 = createTestVectors(50, { prefix: 'c2', clusterId: '0002' })

      mockR2.data.set('vectors/cluster-0000.parquet', createMockParquetData(cluster0))
      mockR2.data.set('vectors/cluster-0001.parquet', createMockParquetData(cluster1))
      mockR2.data.set('vectors/cluster-0002.parquet', createMockParquetData(cluster2))

      // Candidates from all clusters, interleaved
      const candidates: RerankCandidate[] = [
        { id: 'c0_000010', approximateScore: 0.9, clusterId: '0000' },
        { id: 'c1_000020', approximateScore: 0.89, clusterId: '0001' },
        { id: 'c2_000030', approximateScore: 0.88, clusterId: '0002' },
        { id: 'c0_000015', approximateScore: 0.87, clusterId: '0000' },
        { id: 'c1_000025', approximateScore: 0.86, clusterId: '0001' },
        { id: 'c2_000035', approximateScore: 0.85, clusterId: '0002' },
      ]

      // Act
      const result = await fetcher.fetchCandidateVectors(candidates)

      // Assert: Only 3 R2 reads (one per cluster), not 6 (one per candidate)
      const getOps = mockR2.operations.filter(op => op.type === 'get')
      expect(getOps.length).toBe(3)
      expect(result.stats.r2Subrequests).toBe(3)
    })

    it('uses range requests for selective row group reads', async () => {
      // Arrange: Large cluster file
      const vectors = createTestVectors(10000, { dimensions: 384 })
      const parquetData = createMockParquetData(vectors, { rowGroupSize: 1000 })
      mockR2.data.set('vectors/cluster-0000.parquet', parquetData)

      // Request small subset
      const targetIds = ['vec_005000', 'vec_005001', 'vec_005002']

      // Act
      const result = await fetcher.fetchVectors(targetIds)

      // Assert: Should use range request, not read entire file
      expect(result.stats.usedRangeRequest).toBe(true)
      expect(result.stats.bytesRead).toBeLessThan(parquetData.length / 2)
    })

    it('reports R2 operation count in stats', async () => {
      // Arrange
      const cluster0 = createTestVectors(30, { prefix: 'c0', clusterId: '0000' })
      const cluster1 = createTestVectors(30, { prefix: 'c1', clusterId: '0001' })

      mockR2.data.set('vectors/cluster-0000.parquet', createMockParquetData(cluster0))
      mockR2.data.set('vectors/cluster-1111.parquet', createMockParquetData(cluster1))

      const candidates: RerankCandidate[] = [
        { id: 'c0_000005', approximateScore: 0.9, clusterId: '0000' },
        { id: 'c1_000010', approximateScore: 0.85, clusterId: '1111' },
      ]

      // Act
      const result = await fetcher.fetchCandidateVectors(candidates)

      // Assert
      expect(result.stats.r2Subrequests).toBe(2)
      expect(result.stats.clustersAccessed).toBe(2)
    })

    it('limits concurrent R2 requests to prevent throttling', async () => {
      // Arrange: Many cluster files
      const clusterCount = 20
      for (let i = 0; i < clusterCount; i++) {
        const clusterId = i.toString().padStart(4, '0')
        const vectors = createTestVectors(10, { prefix: `c${i}`, clusterId })
        mockR2.data.set(`vectors/cluster-${clusterId}.parquet`, createMockParquetData(vectors))
      }

      // Candidates from all clusters
      const candidates: RerankCandidate[] = Array.from({ length: clusterCount }, (_, i) => ({
        id: `c${i}_000005`,
        approximateScore: 0.9 - i * 0.01,
        clusterId: i.toString().padStart(4, '0'),
      }))

      const limitedFetcher = createRerankFetcher({
        r2: mockR2 as unknown as R2Bucket,
        vectorPrefix: 'vectors/',
        dimensions: 1536,
        maxConcurrentRequests: 5, // Limit concurrent R2 requests
      })

      // Act
      const result = await limitedFetcher.fetchCandidateVectors(candidates)

      // Assert
      expect(result.stats.maxConcurrentRequests).toBeLessThanOrEqual(5)
      expect(result.vectors.size).toBe(clusterCount)
    })
  })

  // ==========================================================================
  // TEST 10: Performance: rerank 100 candidates in <50ms
  // ==========================================================================

  describe('should rerank 100 candidates in <50ms', () => {
    it('completes reranking of 100 candidates within 50ms', async () => {
      // Arrange: Realistic scenario with 100 candidates from 10 clusters
      const clusterData = new Map<string, Array<{ id: string; embedding: Float32Array }>>()
      for (let c = 0; c < 10; c++) {
        const clusterId = c.toString().padStart(4, '0')
        clusterData.set(clusterId, createTestVectors(20, {
          prefix: `c${c}`,
          clusterId,
          dimensions: 1536,
        }))
      }
      setupMockR2WithClusters(mockR2, clusterData)

      // 100 candidates spread across 10 clusters
      const candidates: RerankCandidate[] = Array.from({ length: 100 }, (_, i) => {
        const clusterId = (i % 10).toString().padStart(4, '0')
        return {
          id: `c${i % 10}_${(i * 2 % 20).toString().padStart(6, '0')}`,
          approximateScore: 0.95 - i * 0.001,
          clusterId,
        }
      })

      const query = generateRandomVector(1536, 42)

      // Act
      const startTime = performance.now()
      const result = await fetcher.rerank(query, candidates, { metric: 'cosine', topK: 10 })
      const elapsed = performance.now() - startTime

      // Assert
      expect(elapsed).toBeLessThan(50) // 50ms target
      expect(result.results.length).toBe(10)
      expect(result.stats.totalTimeMs).toBeLessThan(50)

      console.log(`[PERF] Rerank 100 candidates: ${elapsed.toFixed(2)}ms`)
    })

    it('reports timing breakdown for performance analysis', async () => {
      // Arrange
      const vectors = createTestVectors(100)
      const parquetData = createMockParquetData(vectors)
      mockR2.data.set('vectors/cluster-0000.parquet', parquetData)

      const candidates = createTestCandidates(vectors.map(v => v.id))
        .map(c => ({ ...c, clusterId: '0000' }))

      const query = generateRandomVector(1536, 42)

      // Act
      const result = await fetcher.rerank(query, candidates, { metric: 'cosine', topK: 10 })

      // Assert: Detailed timing breakdown available
      expect(result.stats.timingBreakdown).toBeDefined()
      expect(result.stats.timingBreakdown!.fetchMs).toBeDefined()
      expect(result.stats.timingBreakdown!.parseMs).toBeDefined()
      expect(result.stats.timingBreakdown!.computeMs).toBeDefined()
      expect(result.stats.timingBreakdown!.sortMs).toBeDefined()
      expect(result.stats.timingBreakdown!.totalMs).toBeDefined()

      // Total should equal sum of parts (approximately)
      const { fetchMs, parseMs, computeMs, sortMs, totalMs } = result.stats.timingBreakdown!
      expect(totalMs).toBeGreaterThanOrEqual(fetchMs + parseMs + computeMs + sortMs - 1) // Allow 1ms tolerance
    })

    it('uses SIMD-optimized distance computation when available', async () => {
      // Arrange
      const vectors = createTestVectors(100, { dimensions: 1536 })
      const parquetData = createMockParquetData(vectors)
      mockR2.data.set('vectors/cluster-0000.parquet', parquetData)

      const candidates = createTestCandidates(vectors.map(v => v.id))
        .map(c => ({ ...c, clusterId: '0000' }))

      const query = generateRandomVector(1536, 42)

      // Act
      const result = await fetcher.rerank(query, candidates, {
        metric: 'cosine',
        topK: 10,
        useSimd: true,
      })

      // Assert
      expect(result.stats.simdEnabled).toBe(true)
      expect(result.results.length).toBe(10)
    })
  })

  // ==========================================================================
  // TEST 11: Handle Parquet files partitioned by cluster
  // ==========================================================================

  describe('should handle Parquet files partitioned by cluster', () => {
    it('fetches from multiple cluster partitions in parallel', async () => {
      // Arrange: Partitioned structure
      const clusterData = new Map<string, Array<{ id: string; embedding: Float32Array }>>()
      clusterData.set('0000', createTestVectors(50, { prefix: 'c0', clusterId: '0000' }))
      clusterData.set('0001', createTestVectors(50, { prefix: 'c1', clusterId: '0001' }))
      clusterData.set('0002', createTestVectors(50, { prefix: 'c2', clusterId: '0002' }))

      setupMockR2WithClusters(mockR2, clusterData)

      const candidates: RerankCandidate[] = [
        { id: 'c0_000010', approximateScore: 0.9, clusterId: '0000' },
        { id: 'c1_000020', approximateScore: 0.85, clusterId: '0001' },
        { id: 'c2_000030', approximateScore: 0.8, clusterId: '0002' },
      ]

      // Act
      const result = await fetcher.fetchCandidateVectors(candidates)

      // Assert
      expect(result.vectors.size).toBe(3)
      expect(result.stats.clustersAccessed).toBe(3)
      expect(result.stats.parallelFetches).toBeGreaterThanOrEqual(1)
    })

    it('constructs correct partition path from cluster ID', async () => {
      // Arrange
      const vectors = createTestVectors(20, { clusterId: '1234' })
      const parquetData = createMockParquetData(vectors)
      mockR2.data.set('vectors/cluster-1234.parquet', parquetData)

      const candidates: RerankCandidate[] = [
        { id: 'vec_000005', approximateScore: 0.9, clusterId: '1234' },
      ]

      // Act
      await fetcher.fetchCandidateVectors(candidates)

      // Assert: Correct path accessed
      const getOps = mockR2.operations.filter(op => op.type === 'get')
      expect(getOps[0].key).toBe('vectors/cluster-1234.parquet')
    })

    it('supports custom partition path template', async () => {
      // Arrange: Different partition structure
      const customFetcher = createRerankFetcher({
        r2: mockR2 as unknown as R2Bucket,
        vectorPrefix: 'data/',
        dimensions: 1536,
        partitionTemplate: 'ns/{namespace}/clusters/part-{clusterId}.parquet',
      })

      const vectors = createTestVectors(20, { clusterId: '0042' })
      const parquetData = createMockParquetData(vectors)
      mockR2.data.set('data/ns/default/clusters/part-0042.parquet', parquetData)

      const candidates: RerankCandidate[] = [
        { id: 'vec_000005', approximateScore: 0.9, clusterId: '0042' },
      ]

      // Act
      await customFetcher.fetchCandidateVectors(candidates, { namespace: 'default' })

      // Assert
      const getOps = mockR2.operations.filter(op => op.type === 'get')
      expect(getOps[0].key).toBe('data/ns/default/clusters/part-0042.parquet')
    })

    it('handles hierarchical cluster partitioning', async () => {
      // Arrange: Two-level partitioning (region/cluster)
      const customFetcher = createRerankFetcher({
        r2: mockR2 as unknown as R2Bucket,
        vectorPrefix: 'vectors/',
        dimensions: 1536,
        partitionTemplate: '{region}/cluster-{clusterId}.parquet',
      })

      const vectors = createTestVectors(20)
      const parquetData = createMockParquetData(vectors)
      mockR2.data.set('vectors/us-west/cluster-0001.parquet', parquetData)

      const candidates: RerankCandidate[] = [
        { id: 'vec_000010', approximateScore: 0.9, clusterId: '0001' },
      ]

      // Act
      await customFetcher.fetchCandidateVectors(candidates, { region: 'us-west' })

      // Assert
      const getOps = mockR2.operations.filter(op => op.type === 'get')
      expect(getOps[0].key).toBe('vectors/us-west/cluster-0001.parquet')
    })

    it('caches cluster file metadata to avoid repeated header reads', async () => {
      // Arrange
      const vectors = createTestVectors(100)
      const parquetData = createMockParquetData(vectors)
      mockR2.data.set('vectors/cluster-0000.parquet', parquetData)

      // First fetch
      await fetcher.fetchVectors(['vec_000010'])
      const firstOpCount = mockR2.operations.length

      // Second fetch from same cluster
      await fetcher.fetchVectors(['vec_000020'])
      const secondOpCount = mockR2.operations.length - firstOpCount

      // Assert: Second fetch should reuse cached metadata
      expect(secondOpCount).toBeLessThanOrEqual(1) // Only data read, not metadata
    })

    it('invalidates cache when cluster file is updated', async () => {
      // Arrange
      const vectors1 = createTestVectors(50)
      const parquetData1 = createMockParquetData(vectors1)
      mockR2.data.set('vectors/cluster-0000.parquet', parquetData1)

      // First fetch
      await fetcher.fetchVectors(['vec_000010'])

      // Update cluster file
      const vectors2 = createTestVectors(100)
      const parquetData2 = createMockParquetData(vectors2)
      mockR2.data.set('vectors/cluster-0000.parquet', parquetData2)

      // Invalidate cache
      fetcher.invalidateCache('0000')

      // Act: Fetch again
      const result = await fetcher.fetchVectors(['vec_000090'])

      // Assert: Should find the new vector
      expect(result.vectors.has('vec_000090')).toBe(true)
    })
  })

  // ==========================================================================
  // ADDITIONAL EDGE CASES
  // ==========================================================================

  describe('edge cases', () => {
    it('handles empty candidate list', async () => {
      const query = generateRandomVector(1536, 42)

      const result = await fetcher.rerank(query, [], { metric: 'cosine' })

      expect(result.results).toHaveLength(0)
      expect(result.totalCandidates).toBe(0)
    })

    it('handles query with different dimensions than stored vectors', async () => {
      // Arrange: Vectors with 1536 dims
      const vectors = createTestVectors(10, { dimensions: 1536 })
      const parquetData = createMockParquetData(vectors)
      mockR2.data.set('vectors/cluster-0000.parquet', parquetData)

      // Query with wrong dimensions
      const wrongDimQuery = generateRandomVector(768, 42)
      const candidates = createTestCandidates(vectors.slice(0, 5).map(v => v.id))
        .map(c => ({ ...c, clusterId: '0000' }))

      // Act & Assert: Should throw or handle gracefully
      await expect(
        fetcher.rerank(wrongDimQuery, candidates, { metric: 'cosine' })
      ).rejects.toThrow('dimension mismatch')
    })

    it('handles extremely high-dimensional vectors', async () => {
      // Arrange: High-dim vectors (4096)
      const highDimFetcher = createRerankFetcher({
        r2: mockR2 as unknown as R2Bucket,
        vectorPrefix: 'vectors/',
        dimensions: 4096,
      })

      const vectors = createTestVectors(10, { dimensions: 4096 })
      const parquetData = createMockParquetData(vectors)
      mockR2.data.set('vectors/cluster-0000.parquet', parquetData)

      const query = generateRandomVector(4096, 42)
      const candidates = createTestCandidates(vectors.map(v => v.id))
        .map(c => ({ ...c, clusterId: '0000' }))

      // Act
      const result = await highDimFetcher.rerank(query, candidates, { metric: 'cosine' })

      // Assert
      expect(result.results.length).toBe(10)
    })

    it('handles topK of 1', async () => {
      // Arrange
      const vectors = createTestVectors(100)
      const parquetData = createMockParquetData(vectors)
      mockR2.data.set('vectors/cluster-0000.parquet', parquetData)

      const candidates = createTestCandidates(vectors.map(v => v.id))
        .map(c => ({ ...c, clusterId: '0000' }))

      const query = generateRandomVector(1536, 42)

      // Act
      const result = await fetcher.rerank(query, candidates, { metric: 'cosine', topK: 1 })

      // Assert
      expect(result.results.length).toBe(1)
    })

    it('handles duplicate candidate IDs', async () => {
      // Arrange
      const vectors = createTestVectors(10)
      const parquetData = createMockParquetData(vectors)
      mockR2.data.set('vectors/cluster-0000.parquet', parquetData)

      // Duplicate IDs in candidates
      const candidates: RerankCandidate[] = [
        { id: 'vec_000005', approximateScore: 0.9, clusterId: '0000' },
        { id: 'vec_000005', approximateScore: 0.85, clusterId: '0000' }, // Duplicate
        { id: 'vec_000010', approximateScore: 0.8, clusterId: '0000' },
      ]

      const query = generateRandomVector(1536, 42)

      // Act
      const result = await fetcher.rerank(query, candidates, { metric: 'cosine' })

      // Assert: Duplicates should be deduplicated
      const ids = result.results.map(r => r.id)
      const uniqueIds = new Set(ids)
      expect(ids.length).toBe(uniqueIds.size)
    })
  })
})
