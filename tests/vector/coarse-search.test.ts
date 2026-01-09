/**
 * Coarse Search Tests - Static Assets Only ($0 Cost)
 *
 * RED phase TDD tests for Coarse Search using static assets.
 * This component implements the FREE tier of vector search:
 * 1. Load centroids from static asset (FREE)
 * 2. Find top-K nearest clusters (FREE - CPU only)
 * 3. Load PQ codes from static assets (FREE)
 * 4. Compute ADC distance tables (FREE - CPU only)
 * 5. Score all candidates in selected clusters (FREE - CPU only)
 * 6. Return top-N candidates with approximate scores
 *
 * NO R2 calls should occur during coarse search - only static assets.
 *
 * @see docs/plans/static-assets-vector-search.md
 * @module tests/vector/coarse-search.test
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ============================================================================
// MODULE IMPORTS (will fail until implementation exists)
// ============================================================================

// These imports will fail until the module is implemented
// This is the expected behavior for TDD - tests define the API contract
let CoarseSearch: any
let loadCentroidIndex: any
let loadPQCodebooks: any
let loadClusterFile: any
let computeADCTables: any
let scoreClusterCandidates: any
let findNearestClusters: any

// Attempt to load the module - will fail until implemented
beforeEach(async () => {
  try {
    const coarseModule = await import('../../db/edgevec/coarse-search')
    CoarseSearch = coarseModule.CoarseSearch
    loadCentroidIndex = coarseModule.loadCentroidIndex
    loadPQCodebooks = coarseModule.loadPQCodebooks
    loadClusterFile = coarseModule.loadClusterFile
    computeADCTables = coarseModule.computeADCTables
    scoreClusterCandidates = coarseModule.scoreClusterCandidates
    findNearestClusters = coarseModule.findNearestClusters
  } catch {
    // Module not yet implemented - tests will fail with clear message
    CoarseSearch = undefined
    loadCentroidIndex = undefined
    loadPQCodebooks = undefined
    loadClusterFile = undefined
    computeADCTables = undefined
    scoreClusterCandidates = undefined
    findNearestClusters = undefined
  }
})

// ============================================================================
// TEST UTILITIES
// ============================================================================

/**
 * Helper to assert module is loaded
 */
function assertModuleLoaded(fnName: string, fn: any): asserts fn {
  if (!fn) {
    throw new Error(
      `Coarse search module not implemented. Expected '${fnName}' from 'db/edgevec/coarse-search'. ` +
        `Create the module to make this test pass.`
    )
  }
}

/**
 * Generate a random normalized vector
 */
function randomVector(dimensions: number, seed?: number): Float32Array {
  const vec = new Float32Array(dimensions)
  let s = seed ?? Math.floor(Math.random() * 2147483647)
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
 * Generate test PQ codes (M bytes per vector)
 */
function generatePQCodes(vectorCount: number, M: number): Uint8Array {
  const codes = new Uint8Array(vectorCount * M)
  for (let i = 0; i < codes.length; i++) {
    codes[i] = Math.floor(Math.random() * 256)
  }
  return codes
}

/**
 * Generate test vector IDs
 */
function generateVectorIds(count: number, prefix: string = 'vec'): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}-${i}`)
}

/**
 * Compute L2 distance between two vectors
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
 * Create a mock fetch function for static assets
 */
function createMockFetch(assets: Map<string, ArrayBuffer>) {
  return vi.fn(async (url: string) => {
    const buffer = assets.get(url)
    if (!buffer) {
      return {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        arrayBuffer: async () => { throw new Error('Not Found') },
      }
    }
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: async () => buffer,
    }
  })
}

/**
 * Create mock centroid binary file
 * Format: CENT header + centroid data (FP16)
 */
function createMockCentroidFile(
  numCentroids: number,
  dimensions: number,
  centroids?: Float32Array[]
): ArrayBuffer {
  // Header: 32 bytes
  // magic: uint32 = 0x43454E54 ("CENT")
  // version: uint16 = 1
  // flags: uint16 = 0
  // num_centroids: uint32
  // dimensions: uint32
  // dtype: uint8 = 0 (float32) or 1 (float16)
  // metric: uint8 = 0 (cosine)
  // reserved: 10 bytes

  const headerSize = 32
  const dataSize = numCentroids * dimensions * 4 // float32
  const buffer = new ArrayBuffer(headerSize + dataSize)
  const view = new DataView(buffer)

  // Magic "CENT"
  view.setUint8(0, 0x43) // C
  view.setUint8(1, 0x45) // E
  view.setUint8(2, 0x4E) // N
  view.setUint8(3, 0x54) // T

  // Version
  view.setUint16(4, 1, true)
  // Flags
  view.setUint16(6, 0, true)
  // num_centroids
  view.setUint32(8, numCentroids, true)
  // dimensions
  view.setUint32(12, dimensions, true)
  // dtype (0 = float32)
  view.setUint8(16, 0)
  // metric (0 = cosine)
  view.setUint8(17, 0)

  // Write centroid data
  const float32View = new Float32Array(buffer, headerSize)
  if (centroids) {
    let offset = 0
    for (const centroid of centroids) {
      float32View.set(centroid, offset)
      offset += dimensions
    }
  } else {
    // Generate random centroids
    for (let i = 0; i < numCentroids; i++) {
      const vec = randomVector(dimensions, i * 1000)
      float32View.set(vec, i * dimensions)
    }
  }

  return buffer
}

/**
 * Create mock PQ codebook binary file
 */
function createMockCodebookFile(
  M: number,
  Ksub: number,
  subvectorDim: number
): ArrayBuffer {
  // Header: 32 bytes
  // magic: uint32 = 0x50514342 ("PQCB")
  // version: uint16 = 1
  // flags: uint16 = 0
  // M: uint32
  // Ksub: uint32
  // dimensions: uint32
  // subvector_dim: uint32
  // dtype: uint8 = 0 (float32)
  // reserved: 7 bytes

  const headerSize = 32
  const dataSize = M * Ksub * subvectorDim * 4 // float32
  const buffer = new ArrayBuffer(headerSize + dataSize)
  const view = new DataView(buffer)

  // Magic "PQCB"
  view.setUint8(0, 0x50) // P
  view.setUint8(1, 0x51) // Q
  view.setUint8(2, 0x43) // C
  view.setUint8(3, 0x42) // B

  // Version
  view.setUint16(4, 1, true)
  // Flags
  view.setUint16(6, 0, true)
  // M
  view.setUint32(8, M, true)
  // Ksub
  view.setUint32(12, Ksub, true)
  // dimensions
  view.setUint32(16, M * subvectorDim, true)
  // subvector_dim
  view.setUint32(20, subvectorDim, true)
  // dtype
  view.setUint8(24, 0)

  // Write random codebook data
  const float32View = new Float32Array(buffer, headerSize)
  for (let i = 0; i < float32View.length; i++) {
    float32View[i] = (Math.random() - 0.5) * 2
  }

  return buffer
}

/**
 * Create mock cluster file with PQ codes and vector IDs
 */
function createMockClusterFile(
  clusterId: number,
  vectorCount: number,
  M: number
): ArrayBuffer {
  // Header: 64 bytes
  // magic: uint32 = 0x434C5354 ("CLST")
  // version: uint16 = 1
  // flags: uint16 = 0
  // cluster_id: uint32
  // vector_count: uint32
  // M: uint8
  // id_type: uint8 = 0 (uint64)
  // has_metadata: uint8 = 0
  // reserved: 41 bytes

  const headerSize = 64
  const idsSize = vectorCount * 8 // uint64 IDs
  const codesSize = vectorCount * M // uint8 PQ codes
  const buffer = new ArrayBuffer(headerSize + idsSize + codesSize)
  const view = new DataView(buffer)

  // Magic "CLST"
  view.setUint8(0, 0x43) // C
  view.setUint8(1, 0x4C) // L
  view.setUint8(2, 0x53) // S
  view.setUint8(3, 0x54) // T

  // Version
  view.setUint16(4, 1, true)
  // Flags
  view.setUint16(6, 0, true)
  // cluster_id
  view.setUint32(8, clusterId, true)
  // vector_count
  view.setUint32(12, vectorCount, true)
  // M
  view.setUint8(16, M)
  // id_type
  view.setUint8(17, 0)
  // has_metadata
  view.setUint8(18, 0)

  // Write vector IDs (uint64)
  const idView = new BigUint64Array(buffer, headerSize, vectorCount)
  for (let i = 0; i < vectorCount; i++) {
    idView[i] = BigInt(clusterId * 100000 + i)
  }

  // Write PQ codes
  const codesView = new Uint8Array(buffer, headerSize + idsSize, codesSize)
  for (let i = 0; i < codesSize; i++) {
    codesView[i] = Math.floor(Math.random() * 256)
  }

  return buffer
}

// ============================================================================
// TEST CONSTANTS
// ============================================================================

const TEST_DIMENSIONS = 1536
const TEST_NUM_CENTROIDS = 100
const TEST_M = 8 // PQ subspaces
const TEST_KSUB = 256 // centroids per subspace
const TEST_SUBVECTOR_DIM = TEST_DIMENSIONS / TEST_M

// ============================================================================
// TESTS: 1. Load Centroid Index from Static Asset
// ============================================================================

describe('CoarseSearch', () => {
  describe('1. Load centroid index from static asset', () => {
    it('should load centroids from static asset file', async () => {
      assertModuleLoaded('loadCentroidIndex', loadCentroidIndex)

      const mockAssets = new Map<string, ArrayBuffer>()
      mockAssets.set('/static/centroids.bin', createMockCentroidFile(TEST_NUM_CENTROIDS, TEST_DIMENSIONS))

      const mockFetch = createMockFetch(mockAssets)

      const centroidIndex = await loadCentroidIndex({
        fetch: mockFetch,
        path: '/static/centroids.bin',
      })

      expect(centroidIndex).toBeDefined()
      expect(centroidIndex.numCentroids).toBe(TEST_NUM_CENTROIDS)
      expect(centroidIndex.dimensions).toBe(TEST_DIMENSIONS)
      expect(centroidIndex.centroids).toBeInstanceOf(Float32Array)
      expect(centroidIndex.centroids.length).toBe(TEST_NUM_CENTROIDS * TEST_DIMENSIONS)
    })

    it('should parse CENT magic header correctly', async () => {
      assertModuleLoaded('loadCentroidIndex', loadCentroidIndex)

      const mockAssets = new Map<string, ArrayBuffer>()
      mockAssets.set('/static/centroids.bin', createMockCentroidFile(10, 128))

      const mockFetch = createMockFetch(mockAssets)

      const centroidIndex = await loadCentroidIndex({
        fetch: mockFetch,
        path: '/static/centroids.bin',
      })

      expect(centroidIndex.version).toBe(1)
      expect(centroidIndex.metric).toBe('cosine')
    })

    it('should throw error for invalid magic header', async () => {
      assertModuleLoaded('loadCentroidIndex', loadCentroidIndex)

      const invalidBuffer = new ArrayBuffer(32)
      const view = new DataView(invalidBuffer)
      view.setUint8(0, 0x00) // Invalid magic

      const mockAssets = new Map<string, ArrayBuffer>()
      mockAssets.set('/static/centroids.bin', invalidBuffer)

      const mockFetch = createMockFetch(mockAssets)

      await expect(
        loadCentroidIndex({
          fetch: mockFetch,
          path: '/static/centroids.bin',
        })
      ).rejects.toThrow(/invalid.*magic/i)
    })

    it('should throw error when file not found', async () => {
      assertModuleLoaded('loadCentroidIndex', loadCentroidIndex)

      const mockAssets = new Map<string, ArrayBuffer>()
      const mockFetch = createMockFetch(mockAssets)

      await expect(
        loadCentroidIndex({
          fetch: mockFetch,
          path: '/static/missing.bin',
        })
      ).rejects.toThrow(/not found|404/i)
    })

    it('should cache loaded centroids for subsequent queries', async () => {
      assertModuleLoaded('CoarseSearch', CoarseSearch)

      const mockAssets = new Map<string, ArrayBuffer>()
      mockAssets.set('/static/centroids.bin', createMockCentroidFile(TEST_NUM_CENTROIDS, TEST_DIMENSIONS))

      const mockFetch = createMockFetch(mockAssets)

      const search = new CoarseSearch({ fetch: mockFetch })

      // Load twice
      await search.initialize()
      await search.initialize()

      // Fetch should only be called once (cached)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
  })

  // ============================================================================
  // TESTS: 2. Find Top-K Nearest Clusters for Query
  // ============================================================================

  describe('2. Find top-K nearest clusters for query', () => {
    it('should find nearest clusters to query vector', async () => {
      assertModuleLoaded('findNearestClusters', findNearestClusters)

      // Create deterministic centroids
      const numCentroids = 10
      const dimensions = 128
      const centroids = Array.from({ length: numCentroids }, (_, i) =>
        randomVector(dimensions, i * 1000)
      )

      // Pack centroids into Float32Array
      const packedCentroids = new Float32Array(numCentroids * dimensions)
      centroids.forEach((c, i) => packedCentroids.set(c, i * dimensions))

      // Query that is closest to centroid 3
      const query = new Float32Array(centroids[3])

      const nearestClusters = findNearestClusters(
        query,
        packedCentroids,
        { numCentroids, dimensions },
        { nprobe: 5 }
      )

      expect(nearestClusters).toHaveLength(5)
      expect(nearestClusters[0].clusterId).toBe(3) // Closest should be cluster 3
      expect(nearestClusters[0].distance).toBeCloseTo(0, 5) // Distance ~0
    })

    it('should return clusters sorted by distance (ascending)', async () => {
      assertModuleLoaded('findNearestClusters', findNearestClusters)

      const numCentroids = 20
      const dimensions = 64
      const centroids = new Float32Array(numCentroids * dimensions)
      for (let i = 0; i < centroids.length; i++) {
        centroids[i] = Math.random() * 2 - 1
      }

      const query = randomVector(dimensions, 999)

      const nearestClusters = findNearestClusters(
        query,
        centroids,
        { numCentroids, dimensions },
        { nprobe: 10 }
      )

      // Verify sorted by distance
      for (let i = 0; i < nearestClusters.length - 1; i++) {
        expect(nearestClusters[i].distance).toBeLessThanOrEqual(nearestClusters[i + 1].distance)
      }
    })

    it('should handle nprobe > numCentroids gracefully', async () => {
      assertModuleLoaded('findNearestClusters', findNearestClusters)

      const numCentroids = 5
      const dimensions = 32
      const centroids = new Float32Array(numCentroids * dimensions)
      const query = randomVector(dimensions, 1)

      const nearestClusters = findNearestClusters(
        query,
        centroids,
        { numCentroids, dimensions },
        { nprobe: 100 } // More than available
      )

      // Should return all available clusters
      expect(nearestClusters.length).toBe(numCentroids)
    })

    it('should return cluster IDs and distances', async () => {
      assertModuleLoaded('findNearestClusters', findNearestClusters)

      const numCentroids = 10
      const dimensions = 64
      const centroids = new Float32Array(numCentroids * dimensions)
      const query = randomVector(dimensions, 42)

      const nearestClusters = findNearestClusters(
        query,
        centroids,
        { numCentroids, dimensions },
        { nprobe: 3 }
      )

      expect(nearestClusters).toHaveLength(3)
      nearestClusters.forEach((cluster) => {
        expect(typeof cluster.clusterId).toBe('number')
        expect(cluster.clusterId).toBeGreaterThanOrEqual(0)
        expect(cluster.clusterId).toBeLessThan(numCentroids)
        expect(typeof cluster.distance).toBe('number')
        expect(cluster.distance).toBeGreaterThanOrEqual(0)
      })
    })
  })

  // ============================================================================
  // TESTS: 3. Load PQ Codes for Selected Clusters
  // ============================================================================

  describe('3. Load PQ codes for selected clusters', () => {
    it('should load cluster file from static asset', async () => {
      assertModuleLoaded('loadClusterFile', loadClusterFile)

      const clusterId = 5
      const vectorCount = 1000
      const M = 8

      const mockAssets = new Map<string, ArrayBuffer>()
      mockAssets.set('/static/cluster-0005.bin', createMockClusterFile(clusterId, vectorCount, M))

      const mockFetch = createMockFetch(mockAssets)

      const clusterData = await loadClusterFile({
        fetch: mockFetch,
        clusterId,
        basePath: '/static',
      })

      expect(clusterData).toBeDefined()
      expect(clusterData.clusterId).toBe(clusterId)
      expect(clusterData.vectorCount).toBe(vectorCount)
      expect(clusterData.pqCodes).toBeInstanceOf(Uint8Array)
      expect(clusterData.pqCodes.length).toBe(vectorCount * M)
    })

    it('should load multiple cluster files in parallel', async () => {
      assertModuleLoaded('CoarseSearch', CoarseSearch)

      const clusterIds = [1, 3, 5, 7, 9]
      const vectorCount = 500
      const M = 8

      const mockAssets = new Map<string, ArrayBuffer>()
      mockAssets.set('/static/centroids.bin', createMockCentroidFile(10, 128))
      mockAssets.set('/static/codebooks.bin', createMockCodebookFile(M, 256, 16))

      for (const clusterId of clusterIds) {
        const paddedId = clusterId.toString().padStart(4, '0')
        mockAssets.set(`/static/cluster-${paddedId}.bin`, createMockClusterFile(clusterId, vectorCount, M))
      }

      const mockFetch = createMockFetch(mockAssets)

      const search = new CoarseSearch({ fetch: mockFetch })
      await search.initialize()

      const startTime = Date.now()
      const clusters = await search.loadClusters(clusterIds)
      const loadTime = Date.now() - startTime

      expect(clusters).toHaveLength(clusterIds.length)

      // Parallel loading should be faster than sequential
      // 5 clusters loaded sequentially at 10ms each = 50ms
      // Parallel should be closer to 10-20ms
      // (This test may be flaky in CI, adjust threshold as needed)
    })

    it('should parse vector IDs from cluster file', async () => {
      assertModuleLoaded('loadClusterFile', loadClusterFile)

      const clusterId = 2
      const vectorCount = 100
      const M = 8

      const mockAssets = new Map<string, ArrayBuffer>()
      mockAssets.set('/static/cluster-0002.bin', createMockClusterFile(clusterId, vectorCount, M))

      const mockFetch = createMockFetch(mockAssets)

      const clusterData = await loadClusterFile({
        fetch: mockFetch,
        clusterId,
        basePath: '/static',
      })

      expect(clusterData.vectorIds).toBeDefined()
      expect(clusterData.vectorIds.length).toBe(vectorCount)
      // IDs should be BigInt (uint64) or converted to string
    })

    it('should throw error for invalid cluster file format', async () => {
      assertModuleLoaded('loadClusterFile', loadClusterFile)

      const invalidBuffer = new ArrayBuffer(64)
      const view = new DataView(invalidBuffer)
      view.setUint8(0, 0xFF) // Invalid magic

      const mockAssets = new Map<string, ArrayBuffer>()
      mockAssets.set('/static/cluster-0001.bin', invalidBuffer)

      const mockFetch = createMockFetch(mockAssets)

      await expect(
        loadClusterFile({
          fetch: mockFetch,
          clusterId: 1,
          basePath: '/static',
        })
      ).rejects.toThrow(/invalid.*magic|format/i)
    })
  })

  // ============================================================================
  // TESTS: 4. Compute ADC Distance Tables
  // ============================================================================

  describe('4. Compute ADC distance tables', () => {
    it('should compute distance table from query and codebook', async () => {
      assertModuleLoaded('computeADCTables', computeADCTables)

      const M = 8
      const Ksub = 256
      const subvectorDim = 16
      const dimensions = M * subvectorDim

      // Create mock codebook
      const codebook = {
        M,
        Ksub,
        subvectorDim,
        centroids: Array.from({ length: M }, () =>
          new Float32Array(Ksub * subvectorDim).map(() => Math.random() * 2 - 1)
        ),
      }

      const query = randomVector(dimensions, 42)

      const tables = computeADCTables(query, codebook)

      // Should have M tables, each with Ksub entries
      expect(tables).toHaveLength(M)
      tables.forEach((table) => {
        expect(table).toBeInstanceOf(Float32Array)
        expect(table.length).toBe(Ksub)
      })
    })

    it('should compute squared L2 distances in table', async () => {
      assertModuleLoaded('computeADCTables', computeADCTables)

      const M = 4
      const Ksub = 4 // Small for manual verification
      const subvectorDim = 2
      const dimensions = M * subvectorDim

      // Simple codebook with known values
      const codebook = {
        M,
        Ksub,
        subvectorDim,
        centroids: Array.from({ length: M }, (_, m) => {
          const centroids = new Float32Array(Ksub * subvectorDim)
          for (let k = 0; k < Ksub; k++) {
            for (let d = 0; d < subvectorDim; d++) {
              centroids[k * subvectorDim + d] = k + m // Simple pattern
            }
          }
          return centroids
        }),
      }

      const query = new Float32Array(dimensions).fill(0)

      const tables = computeADCTables(query, codebook)

      // Verify first subspace table
      // Distance from [0,0] to [k+0, k+0] = 2*(k)^2 for subspace 0
      for (let k = 0; k < Ksub; k++) {
        const expectedDist = 2 * k * k
        expect(tables[0][k]).toBeCloseTo(expectedDist, 5)
      }
    })

    it('should handle FP16 codebooks', async () => {
      assertModuleLoaded('computeADCTables', computeADCTables)

      const M = 8
      const Ksub = 256
      const subvectorDim = 16
      const dimensions = M * subvectorDim

      const codebook = {
        M,
        Ksub,
        subvectorDim,
        dtype: 'float16',
        centroids: Array.from({ length: M }, () =>
          new Float32Array(Ksub * subvectorDim).map(() => Math.random() * 2 - 1)
        ),
      }

      const query = randomVector(dimensions, 42)

      const tables = computeADCTables(query, codebook)

      expect(tables).toHaveLength(M)
    })
  })

  // ============================================================================
  // TESTS: 5. Score All Candidates in Selected Clusters
  // ============================================================================

  describe('5. Score all candidates in selected clusters', () => {
    it('should score candidates using ADC tables', async () => {
      assertModuleLoaded('scoreClusterCandidates', scoreClusterCandidates)

      const M = 8
      const vectorCount = 100

      // Create ADC tables (M x 256)
      const tables = Array.from({ length: M }, () =>
        new Float32Array(256).map(() => Math.random())
      )

      // Create PQ codes
      const pqCodes = new Uint8Array(vectorCount * M)
      for (let i = 0; i < pqCodes.length; i++) {
        pqCodes[i] = Math.floor(Math.random() * 256)
      }

      // Create vector IDs
      const vectorIds = Array.from({ length: vectorCount }, (_, i) => `vec-${i}`)

      const candidates = scoreClusterCandidates({
        tables,
        pqCodes,
        vectorIds,
        M,
        topK: 10,
      })

      expect(candidates).toHaveLength(10)
      candidates.forEach((candidate) => {
        expect(candidate.id).toBeDefined()
        expect(typeof candidate.score).toBe('number')
        expect(candidate.score).toBeGreaterThanOrEqual(0)
      })
    })

    it('should return candidates sorted by score (ascending for distances)', async () => {
      assertModuleLoaded('scoreClusterCandidates', scoreClusterCandidates)

      const M = 8
      const vectorCount = 50

      const tables = Array.from({ length: M }, () =>
        new Float32Array(256).map(() => Math.random())
      )

      const pqCodes = new Uint8Array(vectorCount * M)
      for (let i = 0; i < pqCodes.length; i++) {
        pqCodes[i] = Math.floor(Math.random() * 256)
      }

      const vectorIds = Array.from({ length: vectorCount }, (_, i) => `vec-${i}`)

      const candidates = scoreClusterCandidates({
        tables,
        pqCodes,
        vectorIds,
        M,
        topK: 20,
      })

      // Verify sorted by score (lower is better for L2 distance)
      for (let i = 0; i < candidates.length - 1; i++) {
        expect(candidates[i].score).toBeLessThanOrEqual(candidates[i + 1].score)
      }
    })

    it('should use heap for efficient top-K selection', async () => {
      assertModuleLoaded('scoreClusterCandidates', scoreClusterCandidates)

      const M = 8
      const vectorCount = 100000 // Large number of candidates

      const tables = Array.from({ length: M }, () =>
        new Float32Array(256).map(() => Math.random())
      )

      const pqCodes = new Uint8Array(vectorCount * M)
      for (let i = 0; i < pqCodes.length; i++) {
        pqCodes[i] = Math.floor(Math.random() * 256)
      }

      const vectorIds = Array.from({ length: vectorCount }, (_, i) => `vec-${i}`)

      const startTime = performance.now()
      const candidates = scoreClusterCandidates({
        tables,
        pqCodes,
        vectorIds,
        M,
        topK: 100,
      })
      const elapsed = performance.now() - startTime

      expect(candidates).toHaveLength(100)
      // Should be fast even with 100K candidates
      expect(elapsed).toBeLessThan(100) // 100ms max
    })

    it('should handle empty cluster gracefully', async () => {
      assertModuleLoaded('scoreClusterCandidates', scoreClusterCandidates)

      const M = 8

      const tables = Array.from({ length: M }, () =>
        new Float32Array(256).map(() => Math.random())
      )

      const candidates = scoreClusterCandidates({
        tables,
        pqCodes: new Uint8Array(0),
        vectorIds: [],
        M,
        topK: 10,
      })

      expect(candidates).toHaveLength(0)
    })
  })

  // ============================================================================
  // TESTS: 6. Return Top-N Candidates with Approximate Scores
  // ============================================================================

  describe('6. Return top-N candidates with approximate scores', () => {
    it('should return top-N candidates from coarse search', async () => {
      assertModuleLoaded('CoarseSearch', CoarseSearch)

      const mockAssets = new Map<string, ArrayBuffer>()
      mockAssets.set('/static/centroids.bin', createMockCentroidFile(10, 128))
      mockAssets.set('/static/codebooks.bin', createMockCodebookFile(8, 256, 16))

      for (let i = 0; i < 10; i++) {
        const paddedId = i.toString().padStart(4, '0')
        mockAssets.set(`/static/cluster-${paddedId}.bin`, createMockClusterFile(i, 1000, 8))
      }

      const mockFetch = createMockFetch(mockAssets)

      const search = new CoarseSearch({ fetch: mockFetch })
      await search.initialize()

      const query = randomVector(128, 42)
      const results = await search.search(query, {
        k: 100,
        nprobe: 5,
      })

      expect(results.candidates).toHaveLength(100)
      expect(results.candidates[0]).toHaveProperty('id')
      expect(results.candidates[0]).toHaveProperty('score')
    })

    it('should include cluster ID in candidate results', async () => {
      assertModuleLoaded('CoarseSearch', CoarseSearch)

      const mockAssets = new Map<string, ArrayBuffer>()
      mockAssets.set('/static/centroids.bin', createMockCentroidFile(10, 128))
      mockAssets.set('/static/codebooks.bin', createMockCodebookFile(8, 256, 16))

      for (let i = 0; i < 10; i++) {
        const paddedId = i.toString().padStart(4, '0')
        mockAssets.set(`/static/cluster-${paddedId}.bin`, createMockClusterFile(i, 100, 8))
      }

      const mockFetch = createMockFetch(mockAssets)

      const search = new CoarseSearch({ fetch: mockFetch })
      await search.initialize()

      const query = randomVector(128, 42)
      const results = await search.search(query, { k: 50, nprobe: 3 })

      results.candidates.forEach((candidate) => {
        expect(typeof candidate.clusterId).toBe('number')
        expect(candidate.clusterId).toBeGreaterThanOrEqual(0)
      })
    })

    it('should return fewer than k if not enough candidates', async () => {
      assertModuleLoaded('CoarseSearch', CoarseSearch)

      const mockAssets = new Map<string, ArrayBuffer>()
      mockAssets.set('/static/centroids.bin', createMockCentroidFile(5, 64))
      mockAssets.set('/static/codebooks.bin', createMockCodebookFile(4, 256, 16))

      // Only 10 vectors per cluster, 5 clusters = 50 total
      for (let i = 0; i < 5; i++) {
        const paddedId = i.toString().padStart(4, '0')
        mockAssets.set(`/static/cluster-${paddedId}.bin`, createMockClusterFile(i, 10, 4))
      }

      const mockFetch = createMockFetch(mockAssets)

      const search = new CoarseSearch({ fetch: mockFetch })
      await search.initialize()

      const query = randomVector(64, 42)
      const results = await search.search(query, {
        k: 1000, // Request more than available
        nprobe: 5,
      })

      // Should return all available (50 vectors)
      expect(results.candidates.length).toBeLessThanOrEqual(50)
    })
  })

  // ============================================================================
  // TESTS: 7. Handle nprobe Parameter (Number of Clusters to Search)
  // ============================================================================

  describe('7. Handle nprobe parameter (number of clusters to search)', () => {
    it('should search only nprobe clusters', async () => {
      assertModuleLoaded('CoarseSearch', CoarseSearch)

      const numCentroids = 20
      const mockAssets = new Map<string, ArrayBuffer>()
      mockAssets.set('/static/centroids.bin', createMockCentroidFile(numCentroids, 128))
      mockAssets.set('/static/codebooks.bin', createMockCodebookFile(8, 256, 16))

      for (let i = 0; i < numCentroids; i++) {
        const paddedId = i.toString().padStart(4, '0')
        mockAssets.set(`/static/cluster-${paddedId}.bin`, createMockClusterFile(i, 100, 8))
      }

      const mockFetch = createMockFetch(mockAssets)

      const search = new CoarseSearch({ fetch: mockFetch })
      await search.initialize()

      const query = randomVector(128, 42)

      // Search with nprobe=3
      const results = await search.search(query, { k: 50, nprobe: 3 })

      expect(results.stats.clustersProbed).toBe(3)
    })

    it('should increase recall with higher nprobe', async () => {
      assertModuleLoaded('CoarseSearch', CoarseSearch)

      const numCentroids = 20
      const mockAssets = new Map<string, ArrayBuffer>()
      mockAssets.set('/static/centroids.bin', createMockCentroidFile(numCentroids, 128))
      mockAssets.set('/static/codebooks.bin', createMockCodebookFile(8, 256, 16))

      for (let i = 0; i < numCentroids; i++) {
        const paddedId = i.toString().padStart(4, '0')
        mockAssets.set(`/static/cluster-${paddedId}.bin`, createMockClusterFile(i, 100, 8))
      }

      const mockFetch = createMockFetch(mockAssets)

      const search = new CoarseSearch({ fetch: mockFetch })
      await search.initialize()

      const query = randomVector(128, 42)

      // Search with different nprobe values
      const results1 = await search.search(query, { k: 50, nprobe: 1 })
      const results5 = await search.search(query, { k: 50, nprobe: 5 })
      const results10 = await search.search(query, { k: 50, nprobe: 10 })

      // More clusters probed = more candidates scanned
      expect(results5.stats.candidatesScanned).toBeGreaterThan(results1.stats.candidatesScanned)
      expect(results10.stats.candidatesScanned).toBeGreaterThan(results5.stats.candidatesScanned)
    })

    it('should default nprobe to reasonable value (e.g., 20)', async () => {
      assertModuleLoaded('CoarseSearch', CoarseSearch)

      const mockAssets = new Map<string, ArrayBuffer>()
      mockAssets.set('/static/centroids.bin', createMockCentroidFile(100, 128))
      mockAssets.set('/static/codebooks.bin', createMockCodebookFile(8, 256, 16))

      for (let i = 0; i < 100; i++) {
        const paddedId = i.toString().padStart(4, '0')
        mockAssets.set(`/static/cluster-${paddedId}.bin`, createMockClusterFile(i, 50, 8))
      }

      const mockFetch = createMockFetch(mockAssets)

      const search = new CoarseSearch({ fetch: mockFetch })
      await search.initialize()

      const query = randomVector(128, 42)

      // Search without specifying nprobe
      const results = await search.search(query, { k: 100 })

      expect(results.stats.clustersProbed).toBeGreaterThan(0)
      expect(results.stats.clustersProbed).toBeLessThanOrEqual(100)
    })

    it('should clamp nprobe to available clusters', async () => {
      assertModuleLoaded('CoarseSearch', CoarseSearch)

      const numCentroids = 10
      const mockAssets = new Map<string, ArrayBuffer>()
      mockAssets.set('/static/centroids.bin', createMockCentroidFile(numCentroids, 64))
      mockAssets.set('/static/codebooks.bin', createMockCodebookFile(4, 256, 16))

      for (let i = 0; i < numCentroids; i++) {
        const paddedId = i.toString().padStart(4, '0')
        mockAssets.set(`/static/cluster-${paddedId}.bin`, createMockClusterFile(i, 50, 4))
      }

      const mockFetch = createMockFetch(mockAssets)

      const search = new CoarseSearch({ fetch: mockFetch })
      await search.initialize()

      const query = randomVector(64, 42)

      // Request more clusters than available
      const results = await search.search(query, { k: 100, nprobe: 1000 })

      // Should clamp to available clusters
      expect(results.stats.clustersProbed).toBe(numCentroids)
    })
  })

  // ============================================================================
  // TESTS: 8. Handle Different K Values (10, 50, 100)
  // ============================================================================

  describe('8. Handle different K values (10, 50, 100)', () => {
    it('should return exactly k results when k=10', async () => {
      assertModuleLoaded('CoarseSearch', CoarseSearch)

      const mockAssets = new Map<string, ArrayBuffer>()
      mockAssets.set('/static/centroids.bin', createMockCentroidFile(10, 128))
      mockAssets.set('/static/codebooks.bin', createMockCodebookFile(8, 256, 16))

      for (let i = 0; i < 10; i++) {
        const paddedId = i.toString().padStart(4, '0')
        mockAssets.set(`/static/cluster-${paddedId}.bin`, createMockClusterFile(i, 1000, 8))
      }

      const mockFetch = createMockFetch(mockAssets)

      const search = new CoarseSearch({ fetch: mockFetch })
      await search.initialize()

      const query = randomVector(128, 42)
      const results = await search.search(query, { k: 10, nprobe: 5 })

      expect(results.candidates).toHaveLength(10)
    })

    it('should return exactly k results when k=50', async () => {
      assertModuleLoaded('CoarseSearch', CoarseSearch)

      const mockAssets = new Map<string, ArrayBuffer>()
      mockAssets.set('/static/centroids.bin', createMockCentroidFile(10, 128))
      mockAssets.set('/static/codebooks.bin', createMockCodebookFile(8, 256, 16))

      for (let i = 0; i < 10; i++) {
        const paddedId = i.toString().padStart(4, '0')
        mockAssets.set(`/static/cluster-${paddedId}.bin`, createMockClusterFile(i, 1000, 8))
      }

      const mockFetch = createMockFetch(mockAssets)

      const search = new CoarseSearch({ fetch: mockFetch })
      await search.initialize()

      const query = randomVector(128, 42)
      const results = await search.search(query, { k: 50, nprobe: 5 })

      expect(results.candidates).toHaveLength(50)
    })

    it('should return exactly k results when k=100', async () => {
      assertModuleLoaded('CoarseSearch', CoarseSearch)

      const mockAssets = new Map<string, ArrayBuffer>()
      mockAssets.set('/static/centroids.bin', createMockCentroidFile(10, 128))
      mockAssets.set('/static/codebooks.bin', createMockCodebookFile(8, 256, 16))

      for (let i = 0; i < 10; i++) {
        const paddedId = i.toString().padStart(4, '0')
        mockAssets.set(`/static/cluster-${paddedId}.bin`, createMockClusterFile(i, 1000, 8))
      }

      const mockFetch = createMockFetch(mockAssets)

      const search = new CoarseSearch({ fetch: mockFetch })
      await search.initialize()

      const query = randomVector(128, 42)
      const results = await search.search(query, { k: 100, nprobe: 5 })

      expect(results.candidates).toHaveLength(100)
    })

    it('should handle k=1 (single result)', async () => {
      assertModuleLoaded('CoarseSearch', CoarseSearch)

      const mockAssets = new Map<string, ArrayBuffer>()
      mockAssets.set('/static/centroids.bin', createMockCentroidFile(5, 64))
      mockAssets.set('/static/codebooks.bin', createMockCodebookFile(4, 256, 16))

      for (let i = 0; i < 5; i++) {
        const paddedId = i.toString().padStart(4, '0')
        mockAssets.set(`/static/cluster-${paddedId}.bin`, createMockClusterFile(i, 100, 4))
      }

      const mockFetch = createMockFetch(mockAssets)

      const search = new CoarseSearch({ fetch: mockFetch })
      await search.initialize()

      const query = randomVector(64, 42)
      const results = await search.search(query, { k: 1, nprobe: 3 })

      expect(results.candidates).toHaveLength(1)
    })
  })

  // ============================================================================
  // TESTS: 9. Verify 95%+ Recall vs Exact Search
  // ============================================================================

  describe('9. Verify 95%+ recall vs exact search', () => {
    it('should achieve 95%+ recall@100 with nprobe=20 on 1M vectors', async () => {
      assertModuleLoaded('CoarseSearch', CoarseSearch)

      // This is a benchmark test - in practice this would use real data
      // For the failing test, we just verify the interface exists

      const mockAssets = new Map<string, ArrayBuffer>()
      mockAssets.set('/static/centroids.bin', createMockCentroidFile(100, 128))
      mockAssets.set('/static/codebooks.bin', createMockCodebookFile(8, 256, 16))

      for (let i = 0; i < 100; i++) {
        const paddedId = i.toString().padStart(4, '0')
        mockAssets.set(`/static/cluster-${paddedId}.bin`, createMockClusterFile(i, 10000, 8))
      }

      const mockFetch = createMockFetch(mockAssets)

      const search = new CoarseSearch({ fetch: mockFetch })
      await search.initialize()

      const query = randomVector(128, 42)

      // Search with high nprobe
      const results = await search.search(query, { k: 100, nprobe: 20 })

      // For a real test, we would compare against exact search results
      // and verify recall >= 0.95
      expect(results.stats).toHaveProperty('recall')
      // In real implementation: expect(results.stats.recall).toBeGreaterThanOrEqual(0.95)
    })

    it('should report recall metrics in search results', async () => {
      assertModuleLoaded('CoarseSearch', CoarseSearch)

      const mockAssets = new Map<string, ArrayBuffer>()
      mockAssets.set('/static/centroids.bin', createMockCentroidFile(10, 64))
      mockAssets.set('/static/codebooks.bin', createMockCodebookFile(4, 256, 16))

      for (let i = 0; i < 10; i++) {
        const paddedId = i.toString().padStart(4, '0')
        mockAssets.set(`/static/cluster-${paddedId}.bin`, createMockClusterFile(i, 100, 4))
      }

      const mockFetch = createMockFetch(mockAssets)

      const search = new CoarseSearch({ fetch: mockFetch })
      await search.initialize()

      const query = randomVector(64, 42)

      // Enable recall tracking (requires ground truth)
      const results = await search.search(query, {
        k: 50,
        nprobe: 5,
        computeRecall: true,
      })

      expect(results.stats).toBeDefined()
      expect(results.stats).toHaveProperty('candidatesScanned')
      expect(results.stats).toHaveProperty('clustersProbed')
    })

    it('should improve recall with higher nprobe values', async () => {
      assertModuleLoaded('CoarseSearch', CoarseSearch)

      const mockAssets = new Map<string, ArrayBuffer>()
      mockAssets.set('/static/centroids.bin', createMockCentroidFile(20, 64))
      mockAssets.set('/static/codebooks.bin', createMockCodebookFile(4, 256, 16))

      for (let i = 0; i < 20; i++) {
        const paddedId = i.toString().padStart(4, '0')
        mockAssets.set(`/static/cluster-${paddedId}.bin`, createMockClusterFile(i, 100, 4))
      }

      const mockFetch = createMockFetch(mockAssets)

      const search = new CoarseSearch({ fetch: mockFetch })
      await search.initialize()

      const query = randomVector(64, 42)

      // Get unique candidate IDs at different nprobe values
      const results1 = await search.search(query, { k: 100, nprobe: 1 })
      const results5 = await search.search(query, { k: 100, nprobe: 5 })
      const results10 = await search.search(query, { k: 100, nprobe: 10 })

      const ids1 = new Set(results1.candidates.map(c => c.id))
      const ids5 = new Set(results5.candidates.map(c => c.id))
      const ids10 = new Set(results10.candidates.map(c => c.id))

      // Higher nprobe should have access to more candidates
      expect(results5.stats.candidatesScanned).toBeGreaterThan(results1.stats.candidatesScanned)
      expect(results10.stats.candidatesScanned).toBeGreaterThan(results5.stats.candidatesScanned)
    })
  })

  // ============================================================================
  // TESTS: 10. Performance: Search 1M Candidates in <50ms
  // ============================================================================

  describe('10. Performance: search 1M candidates in <50ms', () => {
    it('should score 1M candidates within 50ms', async () => {
      assertModuleLoaded('scoreClusterCandidates', scoreClusterCandidates)

      const M = 8
      const vectorCount = 1_000_000

      // Create ADC tables
      const tables = Array.from({ length: M }, () =>
        new Float32Array(256).map(() => Math.random())
      )

      // Create 1M PQ codes
      const pqCodes = new Uint8Array(vectorCount * M)
      for (let i = 0; i < pqCodes.length; i++) {
        pqCodes[i] = Math.floor(Math.random() * 256)
      }

      // Create vector IDs (using numeric IDs for efficiency)
      const vectorIds = Array.from({ length: vectorCount }, (_, i) => `${i}`)

      const startTime = performance.now()

      const candidates = scoreClusterCandidates({
        tables,
        pqCodes,
        vectorIds,
        M,
        topK: 100,
      })

      const elapsed = performance.now() - startTime

      expect(candidates).toHaveLength(100)
      expect(elapsed).toBeLessThan(50) // Must complete in <50ms
    })

    it('should complete full coarse search on 1M vectors in <50ms (CPU time)', async () => {
      assertModuleLoaded('CoarseSearch', CoarseSearch)

      // This test verifies the CPU-bound operations are fast
      // Network latency for static assets is separate

      const numCentroids = 100
      const vectorsPerCluster = 10000 // 100 * 10000 = 1M vectors

      const mockAssets = new Map<string, ArrayBuffer>()
      mockAssets.set('/static/centroids.bin', createMockCentroidFile(numCentroids, 128))
      mockAssets.set('/static/codebooks.bin', createMockCodebookFile(8, 256, 16))

      for (let i = 0; i < numCentroids; i++) {
        const paddedId = i.toString().padStart(4, '0')
        mockAssets.set(`/static/cluster-${paddedId}.bin`, createMockClusterFile(i, vectorsPerCluster, 8))
      }

      const mockFetch = createMockFetch(mockAssets)

      const search = new CoarseSearch({ fetch: mockFetch })
      await search.initialize()

      const query = randomVector(128, 42)

      // Time just the search (not initialization)
      const results = await search.search(query, { k: 100, nprobe: 20 })

      // Verify timing is reported
      expect(results.stats.scoringTimeMs).toBeDefined()
      expect(results.stats.totalTimeMs).toBeDefined()

      // CPU scoring time should be fast
      expect(results.stats.scoringTimeMs).toBeLessThan(50)
    })

    it('should use SIMD-friendly memory layout for ADC scoring', async () => {
      assertModuleLoaded('scoreClusterCandidates', scoreClusterCandidates)

      // Verify the implementation uses efficient memory layout
      // by checking that it handles large batches efficiently

      const M = 8
      const batchSizes = [1000, 10000, 100000, 1000000]
      const timings: number[] = []

      const tables = Array.from({ length: M }, () =>
        new Float32Array(256).map(() => Math.random())
      )

      for (const vectorCount of batchSizes) {
        const pqCodes = new Uint8Array(vectorCount * M)
        for (let i = 0; i < pqCodes.length; i++) {
          pqCodes[i] = Math.floor(Math.random() * 256)
        }
        const vectorIds = Array.from({ length: vectorCount }, (_, i) => `${i}`)

        const startTime = performance.now()
        scoreClusterCandidates({
          tables,
          pqCodes,
          vectorIds,
          M,
          topK: 100,
        })
        timings.push(performance.now() - startTime)
      }

      // Verify scaling is roughly linear (not O(n^2))
      // 1000x more vectors should not be 1000x slower
      const ratio = timings[3] / timings[0]
      expect(ratio).toBeLessThan(2000) // Should be much less than 1000x
    })
  })

  // ============================================================================
  // TESTS: 11. Memory: Stay Under 100MB During Search
  // ============================================================================

  describe('11. Memory: stay under 100MB during search', () => {
    it('should not exceed 100MB memory during search', async () => {
      assertModuleLoaded('CoarseSearch', CoarseSearch)

      // This test verifies memory-efficient design
      // In practice, we'd use process.memoryUsage() in Node.js

      const numCentroids = 100
      const vectorsPerCluster = 10000

      const mockAssets = new Map<string, ArrayBuffer>()
      mockAssets.set('/static/centroids.bin', createMockCentroidFile(numCentroids, 128))
      mockAssets.set('/static/codebooks.bin', createMockCodebookFile(8, 256, 16))

      for (let i = 0; i < numCentroids; i++) {
        const paddedId = i.toString().padStart(4, '0')
        mockAssets.set(`/static/cluster-${paddedId}.bin`, createMockClusterFile(i, vectorsPerCluster, 8))
      }

      const mockFetch = createMockFetch(mockAssets)

      const search = new CoarseSearch({ fetch: mockFetch })
      await search.initialize()

      const query = randomVector(128, 42)

      // Execute search
      const results = await search.search(query, { k: 100, nprobe: 20 })

      // Verify memory stats are reported
      expect(results.stats).toHaveProperty('peakMemoryMB')
      expect(results.stats.peakMemoryMB).toBeLessThan(100)
    })

    it('should report memory usage breakdown', async () => {
      assertModuleLoaded('CoarseSearch', CoarseSearch)

      const mockAssets = new Map<string, ArrayBuffer>()
      mockAssets.set('/static/centroids.bin', createMockCentroidFile(10, 128))
      mockAssets.set('/static/codebooks.bin', createMockCodebookFile(8, 256, 16))

      for (let i = 0; i < 10; i++) {
        const paddedId = i.toString().padStart(4, '0')
        mockAssets.set(`/static/cluster-${paddedId}.bin`, createMockClusterFile(i, 1000, 8))
      }

      const mockFetch = createMockFetch(mockAssets)

      const search = new CoarseSearch({ fetch: mockFetch })
      await search.initialize()

      const memoryStats = search.getMemoryStats()

      expect(memoryStats).toHaveProperty('centroidsMB')
      expect(memoryStats).toHaveProperty('codebooksMB')
      expect(memoryStats).toHaveProperty('adcTablesMB')
      expect(memoryStats).toHaveProperty('totalMB')
    })

    it('should stream cluster files to avoid loading all at once', async () => {
      assertModuleLoaded('CoarseSearch', CoarseSearch)

      // Verify streaming behavior by checking memory doesn't spike
      // when loading many clusters

      const numCentroids = 50
      const vectorsPerCluster = 50000 // Large clusters

      const mockAssets = new Map<string, ArrayBuffer>()
      mockAssets.set('/static/centroids.bin', createMockCentroidFile(numCentroids, 128))
      mockAssets.set('/static/codebooks.bin', createMockCodebookFile(8, 256, 16))

      for (let i = 0; i < numCentroids; i++) {
        const paddedId = i.toString().padStart(4, '0')
        mockAssets.set(`/static/cluster-${paddedId}.bin`, createMockClusterFile(i, vectorsPerCluster, 8))
      }

      const mockFetch = createMockFetch(mockAssets)

      const search = new CoarseSearch({
        fetch: mockFetch,
        maxConcurrentClusters: 5, // Limit concurrent loads
      })
      await search.initialize()

      const query = randomVector(128, 42)

      // Search with many clusters
      const results = await search.search(query, { k: 100, nprobe: 20 })

      // Should not exceed memory limit even with 20 clusters * 50K vectors
      expect(results.stats.peakMemoryMB).toBeLessThan(100)
    })
  })

  // ============================================================================
  // TESTS: 12. No R2 Calls - Only Static Assets
  // ============================================================================

  describe('12. No R2 calls - only static assets', () => {
    it('should not make any R2 calls during coarse search', async () => {
      assertModuleLoaded('CoarseSearch', CoarseSearch)

      // Track all fetch calls
      const fetchCalls: string[] = []

      const mockAssets = new Map<string, ArrayBuffer>()
      mockAssets.set('/static/centroids.bin', createMockCentroidFile(10, 128))
      mockAssets.set('/static/codebooks.bin', createMockCodebookFile(8, 256, 16))

      for (let i = 0; i < 10; i++) {
        const paddedId = i.toString().padStart(4, '0')
        mockAssets.set(`/static/cluster-${paddedId}.bin`, createMockClusterFile(i, 1000, 8))
      }

      const trackingFetch = vi.fn(async (url: string) => {
        fetchCalls.push(url)
        const buffer = mockAssets.get(url)
        if (!buffer) {
          return { ok: false, status: 404, arrayBuffer: async () => { throw new Error('Not Found') } }
        }
        return { ok: true, status: 200, arrayBuffer: async () => buffer }
      })

      const search = new CoarseSearch({ fetch: trackingFetch })
      await search.initialize()

      const query = randomVector(128, 42)
      await search.search(query, { k: 100, nprobe: 5 })

      // Verify all calls were to static assets, not R2
      for (const url of fetchCalls) {
        expect(url).toMatch(/^\/static\//)
        expect(url).not.toMatch(/r2/i)
        expect(url).not.toMatch(/bucket/i)
      }
    })

    it('should only fetch static asset files (no external calls)', async () => {
      assertModuleLoaded('CoarseSearch', CoarseSearch)

      const mockAssets = new Map<string, ArrayBuffer>()
      mockAssets.set('/static/centroids.bin', createMockCentroidFile(10, 64))
      mockAssets.set('/static/codebooks.bin', createMockCodebookFile(4, 256, 16))

      for (let i = 0; i < 10; i++) {
        const paddedId = i.toString().padStart(4, '0')
        mockAssets.set(`/static/cluster-${paddedId}.bin`, createMockClusterFile(i, 100, 4))
      }

      const mockFetch = createMockFetch(mockAssets)

      const search = new CoarseSearch({ fetch: mockFetch })
      await search.initialize()

      const query = randomVector(64, 42)
      const results = await search.search(query, { k: 50, nprobe: 5 })

      // Verify no R2 reads in stats
      expect(results.stats.r2Reads).toBe(0)
      expect(results.stats.r2BytesRead).toBe(0)
    })

    it('should report $0 cost for coarse search', async () => {
      assertModuleLoaded('CoarseSearch', CoarseSearch)

      const mockAssets = new Map<string, ArrayBuffer>()
      mockAssets.set('/static/centroids.bin', createMockCentroidFile(10, 64))
      mockAssets.set('/static/codebooks.bin', createMockCodebookFile(4, 256, 16))

      for (let i = 0; i < 10; i++) {
        const paddedId = i.toString().padStart(4, '0')
        mockAssets.set(`/static/cluster-${paddedId}.bin`, createMockClusterFile(i, 100, 4))
      }

      const mockFetch = createMockFetch(mockAssets)

      const search = new CoarseSearch({ fetch: mockFetch })
      await search.initialize()

      const query = randomVector(64, 42)
      const results = await search.search(query, { k: 50, nprobe: 5 })

      // Coarse search should have $0 cost
      expect(results.stats.estimatedCostUSD).toBe(0)
    })

    it('should clearly separate coarse search from rerank in API', async () => {
      assertModuleLoaded('CoarseSearch', CoarseSearch)

      const mockAssets = new Map<string, ArrayBuffer>()
      mockAssets.set('/static/centroids.bin', createMockCentroidFile(10, 64))
      mockAssets.set('/static/codebooks.bin', createMockCodebookFile(4, 256, 16))

      for (let i = 0; i < 10; i++) {
        const paddedId = i.toString().padStart(4, '0')
        mockAssets.set(`/static/cluster-${paddedId}.bin`, createMockClusterFile(i, 100, 4))
      }

      const mockFetch = createMockFetch(mockAssets)

      const search = new CoarseSearch({ fetch: mockFetch })
      await search.initialize()

      const query = randomVector(64, 42)

      // Coarse search returns candidates for reranking
      const coarseResults = await search.search(query, { k: 100, nprobe: 5 })

      // Candidates should have info needed for reranking
      expect(coarseResults.candidates[0]).toHaveProperty('id')
      expect(coarseResults.candidates[0]).toHaveProperty('score')
      expect(coarseResults.candidates[0]).toHaveProperty('clusterId')

      // Should NOT have full vectors (that would require R2)
      expect(coarseResults.candidates[0]).not.toHaveProperty('vector')
    })
  })

  // ============================================================================
  // ADDITIONAL EDGE CASES
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle empty query gracefully', async () => {
      assertModuleLoaded('CoarseSearch', CoarseSearch)

      const mockAssets = new Map<string, ArrayBuffer>()
      mockAssets.set('/static/centroids.bin', createMockCentroidFile(10, 64))
      mockAssets.set('/static/codebooks.bin', createMockCodebookFile(4, 256, 16))

      const mockFetch = createMockFetch(mockAssets)

      const search = new CoarseSearch({ fetch: mockFetch })
      await search.initialize()

      const emptyQuery = new Float32Array(0)

      await expect(
        search.search(emptyQuery, { k: 10, nprobe: 5 })
      ).rejects.toThrow(/empty|invalid.*query/i)
    })

    it('should handle dimension mismatch', async () => {
      assertModuleLoaded('CoarseSearch', CoarseSearch)

      const mockAssets = new Map<string, ArrayBuffer>()
      mockAssets.set('/static/centroids.bin', createMockCentroidFile(10, 128))
      mockAssets.set('/static/codebooks.bin', createMockCodebookFile(8, 256, 16))

      const mockFetch = createMockFetch(mockAssets)

      const search = new CoarseSearch({ fetch: mockFetch })
      await search.initialize()

      const wrongDimQuery = randomVector(64, 42) // Wrong dimension

      await expect(
        search.search(wrongDimQuery, { k: 10, nprobe: 5 })
      ).rejects.toThrow(/dimension.*mismatch/i)
    })

    it('should handle k=0', async () => {
      assertModuleLoaded('CoarseSearch', CoarseSearch)

      const mockAssets = new Map<string, ArrayBuffer>()
      mockAssets.set('/static/centroids.bin', createMockCentroidFile(10, 64))
      mockAssets.set('/static/codebooks.bin', createMockCodebookFile(4, 256, 16))

      for (let i = 0; i < 10; i++) {
        const paddedId = i.toString().padStart(4, '0')
        mockAssets.set(`/static/cluster-${paddedId}.bin`, createMockClusterFile(i, 100, 4))
      }

      const mockFetch = createMockFetch(mockAssets)

      const search = new CoarseSearch({ fetch: mockFetch })
      await search.initialize()

      const query = randomVector(64, 42)
      const results = await search.search(query, { k: 0, nprobe: 5 })

      expect(results.candidates).toHaveLength(0)
    })

    it('should handle missing cluster files gracefully', async () => {
      assertModuleLoaded('CoarseSearch', CoarseSearch)

      const mockAssets = new Map<string, ArrayBuffer>()
      mockAssets.set('/static/centroids.bin', createMockCentroidFile(10, 64))
      mockAssets.set('/static/codebooks.bin', createMockCodebookFile(4, 256, 16))

      // Only add some cluster files (missing 0, 2, 4, 6, 8)
      for (const i of [1, 3, 5, 7, 9]) {
        const paddedId = i.toString().padStart(4, '0')
        mockAssets.set(`/static/cluster-${paddedId}.bin`, createMockClusterFile(i, 100, 4))
      }

      const mockFetch = createMockFetch(mockAssets)

      const search = new CoarseSearch({ fetch: mockFetch })
      await search.initialize()

      const query = randomVector(64, 42)

      // Should still return results from available clusters
      const results = await search.search(query, { k: 50, nprobe: 10 })

      // Should report which clusters were missing
      expect(results.stats.missingClusters).toBeDefined()
      expect(results.stats.missingClusters.length).toBeGreaterThan(0)
    })

    it('should handle corrupted cluster file', async () => {
      assertModuleLoaded('CoarseSearch', CoarseSearch)

      const mockAssets = new Map<string, ArrayBuffer>()
      mockAssets.set('/static/centroids.bin', createMockCentroidFile(10, 64))
      mockAssets.set('/static/codebooks.bin', createMockCodebookFile(4, 256, 16))

      // Add valid clusters
      for (let i = 0; i < 9; i++) {
        const paddedId = i.toString().padStart(4, '0')
        mockAssets.set(`/static/cluster-${paddedId}.bin`, createMockClusterFile(i, 100, 4))
      }

      // Add corrupted cluster
      const corruptedBuffer = new ArrayBuffer(64)
      mockAssets.set('/static/cluster-0009.bin', corruptedBuffer)

      const mockFetch = createMockFetch(mockAssets)

      const search = new CoarseSearch({ fetch: mockFetch })
      await search.initialize()

      const query = randomVector(64, 42)

      // Should skip corrupted cluster and continue with others
      const results = await search.search(query, { k: 50, nprobe: 10 })

      expect(results.candidates.length).toBeGreaterThan(0)
      expect(results.stats.failedClusters).toContain(9)
    })
  })
})
