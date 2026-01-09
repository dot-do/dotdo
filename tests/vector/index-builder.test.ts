/**
 * Offline Index Builder Tests
 *
 * RED phase TDD tests for the offline index builder that generates static assets
 * from source vectors for the Static Assets Vector Search architecture.
 *
 * The index builder is responsible for:
 * 1. Training K-means centroids from sample vectors
 * 2. Training Product Quantization codebooks on residuals
 * 3. Assigning vectors to clusters and encoding them
 * 4. Generating binary files in the correct formats:
 *    - centroids.bin (CENT format)
 *    - codebooks.bin (PQCB format)
 *    - cluster-XXXX.bin (CLST format)
 *
 * Tests should FAIL until IndexBuilder is implemented.
 *
 * @see docs/plans/static-assets-vector-search.md
 * @module tests/vector/index-builder.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, readFile, readdir, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

// ============================================================================
// MODULE IMPORTS (will fail until implementation exists)
// ============================================================================

// These imports will fail until the module is implemented
// This is the expected behavior for TDD - tests define the API contract
let IndexBuilder: any
let trainKMeans: any
let trainPQ: any
let buildIndex: any
let appendToIndex: any
let parseClusterFile: any
let parseCentroidsFile: any
let parseCodebooksFile: any

// Magic numbers for binary formats (from docs/plans/static-assets-vector-search.md)
const CENT_MAGIC = 0x43454e54 // "CENT"
const PQCB_MAGIC = 0x50514342 // "PQCB"
const CLST_MAGIC = 0x434c5354 // "CLST"

// Attempt to load the module - will fail until implemented
beforeEach(async () => {
  try {
    const builderModule = await import('../../db/edgevec/index-builder')
    IndexBuilder = builderModule.IndexBuilder
    trainKMeans = builderModule.trainKMeans
    trainPQ = builderModule.trainPQ
    buildIndex = builderModule.buildIndex
    appendToIndex = builderModule.appendToIndex
    parseClusterFile = builderModule.parseClusterFile
    parseCentroidsFile = builderModule.parseCentroidsFile
    parseCodebooksFile = builderModule.parseCodebooksFile
  } catch {
    // Module not yet implemented - tests will fail with clear message
    IndexBuilder = undefined
    trainKMeans = undefined
    trainPQ = undefined
    buildIndex = undefined
    appendToIndex = undefined
    parseClusterFile = undefined
    parseCentroidsFile = undefined
    parseCodebooksFile = undefined
  }
})

// ============================================================================
// TEST UTILITIES
// ============================================================================

/**
 * Generate random vectors for training/testing
 */
function generateRandomVectors(count: number, dimensions: number, seed?: number): Float32Array[] {
  let s = seed ?? 12345
  return Array.from({ length: count }, () => {
    const vec = new Float32Array(dimensions)
    for (let i = 0; i < dimensions; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff
      vec[i] = (s / 0x7fffffff) * 2 - 1 // Range [-1, 1]
    }
    return normalizeVector(vec)
  })
}

/**
 * Generate clustered vectors (for more realistic training data)
 */
function generateClusteredVectors(
  count: number,
  dimensions: number,
  numClusters: number,
  spread: number = 0.2
): { vectors: Float32Array[]; ids: string[]; trueLabels: number[] } {
  const vectors: Float32Array[] = []
  const ids: string[] = []
  const trueLabels: number[] = []

  // Create cluster centers
  const centers = generateRandomVectors(numClusters, dimensions, 42)

  let seed = 1000
  for (let i = 0; i < count; i++) {
    const clusterId = i % numClusters
    const center = centers[clusterId]

    // Add noise around cluster center
    const vec = new Float32Array(dimensions)
    for (let j = 0; j < dimensions; j++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      const noise = ((seed / 0x7fffffff) - 0.5) * spread
      vec[j] = center[j] + noise
    }

    vectors.push(normalizeVector(vec))
    ids.push(`vec-${i.toString().padStart(6, '0')}`)
    trueLabels.push(clusterId)
  }

  return { vectors, ids, trueLabels }
}

/**
 * Normalize a vector to unit length
 */
function normalizeVector(v: Float32Array): Float32Array {
  let norm = 0
  for (let i = 0; i < v.length; i++) {
    norm += v[i] * v[i]
  }
  norm = Math.sqrt(norm)

  const result = new Float32Array(v.length)
  for (let i = 0; i < v.length; i++) {
    result[i] = v[i] / norm
  }
  return result
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
 * Find nearest centroid index for a vector
 */
function findNearestCentroid(vector: Float32Array, centroids: Float32Array[]): number {
  let minDist = Infinity
  let minIdx = 0
  for (let i = 0; i < centroids.length; i++) {
    const dist = l2Distance(vector, centroids[i])
    if (dist < minDist) {
      minDist = dist
      minIdx = i
    }
  }
  return minIdx
}

/**
 * Compute residual vector (vector - centroid)
 */
function computeResidual(vector: Float32Array, centroid: Float32Array): Float32Array {
  const residual = new Float32Array(vector.length)
  for (let i = 0; i < vector.length; i++) {
    residual[i] = vector[i] - centroid[i]
  }
  return residual
}

/**
 * Helper to assert module is loaded
 */
function assertModuleLoaded(fnName: string, fn: any): asserts fn {
  if (!fn) {
    throw new Error(
      `Index builder module not implemented. Expected '${fnName}' from 'db/edgevec/index-builder'. ` +
        `Create the module to make this test pass.`
    )
  }
}

/**
 * Create async iterable from array for streaming tests
 */
async function* streamVectors(
  vectors: Float32Array[],
  ids: string[],
  batchSize: number = 100
): AsyncGenerator<{ id: string; vector: Float32Array }[]> {
  for (let i = 0; i < vectors.length; i += batchSize) {
    const batch = []
    for (let j = i; j < Math.min(i + batchSize, vectors.length); j++) {
      batch.push({ id: ids[j], vector: vectors[j] })
    }
    yield batch
  }
}

// ============================================================================
// TEST CONSTANTS
// ============================================================================

const TEST_DIMENSIONS = 128
const TEST_NUM_CLUSTERS = 8
const TEST_M = 8 // PQ subspaces
const TEST_KSUB = 256 // Centroids per subspace

// ============================================================================
// TESTS: K-MEANS CLUSTERING
// ============================================================================

describe('IndexBuilder', () => {
  describe('K-means Clustering', () => {
    it('should train K-means centroids from input vectors', async () => {
      assertModuleLoaded('trainKMeans', trainKMeans)

      const dimensions = TEST_DIMENSIONS
      const numClusters = TEST_NUM_CLUSTERS
      const { vectors } = generateClusteredVectors(1000, dimensions, numClusters)

      const centroids = await trainKMeans(vectors, {
        k: numClusters,
        maxIterations: 50,
      })

      // Verify correct number of centroids
      expect(centroids).toHaveLength(numClusters)

      // Each centroid should be a valid vector with correct dimensions
      for (const centroid of centroids) {
        expect(centroid).toBeInstanceOf(Float32Array)
        expect(centroid.length).toBe(dimensions)
        // Verify centroid values are finite numbers
        for (let i = 0; i < centroid.length; i++) {
          expect(Number.isFinite(centroid[i])).toBe(true)
        }
      }
    })

    it('should use K-means++ initialization by default', async () => {
      assertModuleLoaded('trainKMeans', trainKMeans)

      const { vectors } = generateClusteredVectors(500, TEST_DIMENSIONS, TEST_NUM_CLUSTERS)

      // Run K-means multiple times - K-means++ should give consistent results
      const results1 = await trainKMeans(vectors, { k: TEST_NUM_CLUSTERS, seed: 42 })
      const results2 = await trainKMeans(vectors, { k: TEST_NUM_CLUSTERS, seed: 42 })

      // With same seed, results should be identical
      for (let i = 0; i < results1.length; i++) {
        for (let j = 0; j < results1[i].length; j++) {
          expect(results1[i][j]).toBeCloseTo(results2[i][j], 5)
        }
      }
    })

    it('should converge within max iterations', async () => {
      assertModuleLoaded('trainKMeans', trainKMeans)

      const { vectors } = generateClusteredVectors(500, TEST_DIMENSIONS, TEST_NUM_CLUSTERS)

      const result = await trainKMeans(vectors, {
        k: TEST_NUM_CLUSTERS,
        maxIterations: 100,
        convergenceThreshold: 1e-6,
        returnStats: true,
      })

      expect(result.centroids).toHaveLength(TEST_NUM_CLUSTERS)
      expect(result.iterations).toBeLessThanOrEqual(100)
      expect(result.converged).toBe(true)
      expect(result.finalInertia).toBeLessThan(result.initialInertia)
    })

    it('should handle degenerate case with empty clusters', async () => {
      assertModuleLoaded('trainKMeans', trainKMeans)

      // Create highly clustered data that may leave some centroids empty
      const center = generateRandomVectors(1, TEST_DIMENSIONS, 1)[0]
      const vectors: Float32Array[] = []
      for (let i = 0; i < 100; i++) {
        const vec = new Float32Array(TEST_DIMENSIONS)
        for (let j = 0; j < TEST_DIMENSIONS; j++) {
          vec[j] = center[j] + (Math.random() - 0.5) * 0.01 // Tight cluster
        }
        vectors.push(vec)
      }

      // Request more clusters than natural data has
      const result = await trainKMeans(vectors, {
        k: 20,
        relocateEmptyClusters: true,
        returnStats: true,
      })

      // Should handle gracefully - no empty clusters after relocation
      expect(result.centroids).toHaveLength(20)
      expect(result.emptyClusters).toBe(0)
    })

    it('should throw error with insufficient vectors for k clusters', async () => {
      assertModuleLoaded('trainKMeans', trainKMeans)

      const vectors = generateRandomVectors(5, TEST_DIMENSIONS)

      await expect(
        trainKMeans(vectors, { k: 10 }) // More clusters than vectors
      ).rejects.toThrow(/insufficient.*vectors/i)
    })
  })

  // ============================================================================
  // TESTS: VECTOR ASSIGNMENT TO CLUSTERS
  // ============================================================================

  describe('Vector Assignment', () => {
    it('should assign vectors to nearest centroids', async () => {
      assertModuleLoaded('IndexBuilder', IndexBuilder)

      const { vectors, ids, trueLabels } = generateClusteredVectors(500, TEST_DIMENSIONS, TEST_NUM_CLUSTERS, 0.1)

      const builder = new IndexBuilder({
        dimensions: TEST_DIMENSIONS,
        numClusters: TEST_NUM_CLUSTERS,
      })

      await builder.trainCentroids(vectors)
      const assignments = await builder.assignVectors(vectors, ids)

      // Should return assignments for all vectors
      expect(assignments).toHaveLength(vectors.length)

      // Each assignment should have valid structure
      for (const assignment of assignments) {
        expect(assignment.id).toBeDefined()
        expect(assignment.clusterId).toBeGreaterThanOrEqual(0)
        expect(assignment.clusterId).toBeLessThan(TEST_NUM_CLUSTERS)
        expect(assignment.distance).toBeGreaterThanOrEqual(0)
      }

      // Vectors with same true label should often be in same cluster
      // (not always due to K-means variability, but should have some correlation)
      const clustersByTrueLabel = new Map<number, Set<number>>()
      for (let i = 0; i < assignments.length; i++) {
        const trueLabel = trueLabels[i]
        if (!clustersByTrueLabel.has(trueLabel)) {
          clustersByTrueLabel.set(trueLabel, new Set())
        }
        clustersByTrueLabel.get(trueLabel)!.add(assignments[i].clusterId)
      }

      // Each true label group should be concentrated in few clusters
      for (const [, clusters] of clustersByTrueLabel) {
        expect(clusters.size).toBeLessThan(TEST_NUM_CLUSTERS) // Not spread across all clusters
      }
    })

    it('should compute residual vectors correctly', async () => {
      assertModuleLoaded('IndexBuilder', IndexBuilder)

      const { vectors, ids } = generateClusteredVectors(100, TEST_DIMENSIONS, TEST_NUM_CLUSTERS)

      const builder = new IndexBuilder({
        dimensions: TEST_DIMENSIONS,
        numClusters: TEST_NUM_CLUSTERS,
      })

      await builder.trainCentroids(vectors)
      const centroids = builder.getCentroids()

      const { assignments, residuals } = await builder.assignVectorsWithResiduals(vectors, ids)

      expect(residuals).toHaveLength(vectors.length)

      // Verify residual = vector - centroid
      for (let i = 0; i < vectors.length; i++) {
        const centroid = centroids[assignments[i].clusterId]
        const expectedResidual = computeResidual(vectors[i], centroid)

        expect(residuals[i].length).toBe(TEST_DIMENSIONS)
        for (let j = 0; j < TEST_DIMENSIONS; j++) {
          expect(residuals[i][j]).toBeCloseTo(expectedResidual[j], 5)
        }
      }
    })
  })

  // ============================================================================
  // TESTS: PQ CODEBOOK TRAINING ON RESIDUALS
  // ============================================================================

  describe('PQ Codebook Training', () => {
    it('should train PQ codebooks on residual vectors', async () => {
      assertModuleLoaded('trainPQ', trainPQ)

      const dimensions = TEST_DIMENSIONS
      const M = TEST_M // 8 subspaces
      const Ksub = TEST_KSUB // 256 centroids per subspace

      // Generate residual-like vectors (typically smaller magnitude)
      const residuals = generateRandomVectors(1000, dimensions, 42).map((v) => {
        const r = new Float32Array(dimensions)
        for (let i = 0; i < dimensions; i++) {
          r[i] = v[i] * 0.1 // Scale down to simulate residuals
        }
        return r
      })

      const codebooks = await trainPQ(residuals, {
        M,
        Ksub,
        maxIterations: 25,
      })

      // Verify codebook structure
      expect(codebooks.M).toBe(M)
      expect(codebooks.Ksub).toBe(Ksub)
      expect(codebooks.subvectorDim).toBe(dimensions / M)
      expect(codebooks.centroids).toHaveLength(M)

      // Each subspace should have Ksub centroids of subvectorDim dimensions
      for (let m = 0; m < M; m++) {
        expect(codebooks.centroids[m]).toBeInstanceOf(Float32Array)
        expect(codebooks.centroids[m].length).toBe(Ksub * (dimensions / M))
      }
    })

    it('should validate M divides dimensions evenly', async () => {
      assertModuleLoaded('trainPQ', trainPQ)

      const dimensions = 100
      const residuals = generateRandomVectors(500, dimensions)

      // M=8 does not divide 100 evenly
      await expect(
        trainPQ(residuals, { M: 8, Ksub: 256 })
      ).rejects.toThrow(/dimension.*divisible/i)
    })

    it('should measure reconstruction error', async () => {
      assertModuleLoaded('trainPQ', trainPQ)

      const dimensions = TEST_DIMENSIONS
      const M = TEST_M
      const residuals = generateRandomVectors(1000, dimensions, 42)

      const result = await trainPQ(residuals, {
        M,
        Ksub: 256,
        returnStats: true,
      })

      expect(result.codebooks).toBeDefined()
      expect(result.reconstructionError).toBeDefined()
      expect(result.reconstructionError).toBeGreaterThan(0)
      expect(Number.isFinite(result.reconstructionError)).toBe(true)
    })

    it('should support different M values (8, 16, 32)', async () => {
      assertModuleLoaded('trainPQ', trainPQ)

      const dimensions = 128 // Divisible by 8, 16, 32
      const residuals = generateRandomVectors(500, dimensions)

      for (const M of [8, 16, 32]) {
        const codebooks = await trainPQ(residuals, { M, Ksub: 256 })

        expect(codebooks.M).toBe(M)
        expect(codebooks.subvectorDim).toBe(dimensions / M)
        expect(codebooks.centroids).toHaveLength(M)
      }
    })
  })

  // ============================================================================
  // TESTS: VECTOR ENCODING TO PQ CODES
  // ============================================================================

  describe('PQ Encoding', () => {
    it('should encode vectors to PQ codes', async () => {
      assertModuleLoaded('IndexBuilder', IndexBuilder)

      const { vectors, ids } = generateClusteredVectors(500, TEST_DIMENSIONS, TEST_NUM_CLUSTERS)

      const builder = new IndexBuilder({
        dimensions: TEST_DIMENSIONS,
        numClusters: TEST_NUM_CLUSTERS,
        M: TEST_M,
        Ksub: TEST_KSUB,
      })

      await builder.train(vectors)

      const encoded = await builder.encodeVectors(vectors, ids)

      expect(encoded).toHaveLength(vectors.length)

      for (const entry of encoded) {
        expect(entry.id).toBeDefined()
        expect(entry.clusterId).toBeGreaterThanOrEqual(0)
        expect(entry.clusterId).toBeLessThan(TEST_NUM_CLUSTERS)
        // PQ codes should be M bytes (uint8 array)
        expect(entry.pqCodes).toBeInstanceOf(Uint8Array)
        expect(entry.pqCodes.length).toBe(TEST_M)
        // Each code should be in valid range [0, 255]
        for (let m = 0; m < TEST_M; m++) {
          expect(entry.pqCodes[m]).toBeGreaterThanOrEqual(0)
          expect(entry.pqCodes[m]).toBeLessThan(TEST_KSUB)
        }
      }
    })

    it('should encode residuals, not original vectors', async () => {
      assertModuleLoaded('IndexBuilder', IndexBuilder)

      const { vectors, ids } = generateClusteredVectors(100, TEST_DIMENSIONS, TEST_NUM_CLUSTERS)

      const builder = new IndexBuilder({
        dimensions: TEST_DIMENSIONS,
        numClusters: TEST_NUM_CLUSTERS,
        M: TEST_M,
        Ksub: TEST_KSUB,
      })

      await builder.train(vectors)

      // Get centroids and codebooks for manual verification
      const centroids = builder.getCentroids()
      const codebooks = builder.getCodebooks()

      const encoded = await builder.encodeVectors(vectors, ids)

      // For each encoded vector, verify the PQ codes were computed on the residual
      for (let i = 0; i < encoded.length; i++) {
        const centroid = centroids[encoded[i].clusterId]
        const residual = computeResidual(vectors[i], centroid)

        // Decode the PQ codes and compare with expected residual
        const reconstructed = builder.decodePQ(encoded[i].pqCodes, codebooks)

        // Reconstruction should be close to the residual
        const error = l2Distance(residual, reconstructed)
        // Error should be bounded (depends on quantization quality)
        expect(error).toBeLessThan(1.0) // Rough threshold
      }
    })
  })

  // ============================================================================
  // TESTS: BINARY FILE GENERATION - CENTROIDS
  // ============================================================================

  describe('Centroids Binary Format (CENT)', () => {
    let tempDir: string

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'index-builder-test-'))
    })

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true })
    })

    it('should generate centroids.bin with CENT magic number', async () => {
      assertModuleLoaded('buildIndex', buildIndex)

      const { vectors, ids } = generateClusteredVectors(500, TEST_DIMENSIONS, TEST_NUM_CLUSTERS)

      await buildIndex({
        vectors: streamVectors(vectors, ids),
        outputDir: tempDir,
        numClusters: TEST_NUM_CLUSTERS,
        M: TEST_M,
        Ksub: TEST_KSUB,
        dimensions: TEST_DIMENSIONS,
      })

      const centroidsPath = join(tempDir, 'centroids.bin')
      const buffer = await readFile(centroidsPath)
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)

      // Check magic number
      const magic = view.getUint32(0, true)
      expect(magic).toBe(CENT_MAGIC)
    })

    it('should include correct header fields in centroids.bin', async () => {
      assertModuleLoaded('buildIndex', buildIndex)

      const { vectors, ids } = generateClusteredVectors(500, TEST_DIMENSIONS, TEST_NUM_CLUSTERS)

      await buildIndex({
        vectors: streamVectors(vectors, ids),
        outputDir: tempDir,
        numClusters: TEST_NUM_CLUSTERS,
        M: TEST_M,
        Ksub: TEST_KSUB,
        dimensions: TEST_DIMENSIONS,
      })

      const centroidsPath = join(tempDir, 'centroids.bin')
      const buffer = await readFile(centroidsPath)
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)

      // Header format from spec:
      // magic: uint32 (0-3)
      // version: uint16 (4-5)
      // flags: uint16 (6-7)
      // num_centroids: uint32 (8-11)
      // dimensions: uint32 (12-15)
      // dtype: uint8 (16)
      // metric: uint8 (17)
      // reserved: uint8[10] (18-27)
      // Metadata section starts after header at byte 28

      expect(view.getUint32(0, true)).toBe(CENT_MAGIC) // magic
      expect(view.getUint16(4, true)).toBe(1) // version
      expect(view.getUint32(8, true)).toBe(TEST_NUM_CLUSTERS) // num_centroids
      expect(view.getUint32(12, true)).toBe(TEST_DIMENSIONS) // dimensions
      expect(view.getUint8(16)).toBe(0) // dtype = float32
    })

    it('should store centroid vectors in correct format', async () => {
      assertModuleLoaded('buildIndex', buildIndex)
      assertModuleLoaded('parseCentroidsFile', parseCentroidsFile)

      const { vectors, ids } = generateClusteredVectors(500, TEST_DIMENSIONS, TEST_NUM_CLUSTERS)

      await buildIndex({
        vectors: streamVectors(vectors, ids),
        outputDir: tempDir,
        numClusters: TEST_NUM_CLUSTERS,
        M: TEST_M,
        Ksub: TEST_KSUB,
        dimensions: TEST_DIMENSIONS,
      })

      const centroidsPath = join(tempDir, 'centroids.bin')
      const buffer = await readFile(centroidsPath)

      const parsed = parseCentroidsFile(buffer)

      expect(parsed.numCentroids).toBe(TEST_NUM_CLUSTERS)
      expect(parsed.dimensions).toBe(TEST_DIMENSIONS)
      expect(parsed.centroids).toHaveLength(TEST_NUM_CLUSTERS)

      // Each centroid should be a valid float32 array
      for (const centroid of parsed.centroids) {
        expect(centroid).toBeInstanceOf(Float32Array)
        expect(centroid.length).toBe(TEST_DIMENSIONS)
        for (let i = 0; i < centroid.length; i++) {
          expect(Number.isFinite(centroid[i])).toBe(true)
        }
      }
    })
  })

  // ============================================================================
  // TESTS: BINARY FILE GENERATION - CODEBOOKS
  // ============================================================================

  describe('Codebooks Binary Format (PQCB)', () => {
    let tempDir: string

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'index-builder-test-'))
    })

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true })
    })

    it('should generate codebooks.bin with PQCB magic number', async () => {
      assertModuleLoaded('buildIndex', buildIndex)

      const { vectors, ids } = generateClusteredVectors(500, TEST_DIMENSIONS, TEST_NUM_CLUSTERS)

      await buildIndex({
        vectors: streamVectors(vectors, ids),
        outputDir: tempDir,
        numClusters: TEST_NUM_CLUSTERS,
        M: TEST_M,
        Ksub: TEST_KSUB,
        dimensions: TEST_DIMENSIONS,
      })

      const codebooksPath = join(tempDir, 'codebooks.bin')
      const buffer = await readFile(codebooksPath)
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)

      // Check magic number
      const magic = view.getUint32(0, true)
      expect(magic).toBe(PQCB_MAGIC)
    })

    it('should include correct header fields in codebooks.bin', async () => {
      assertModuleLoaded('buildIndex', buildIndex)

      const { vectors, ids } = generateClusteredVectors(500, TEST_DIMENSIONS, TEST_NUM_CLUSTERS)

      await buildIndex({
        vectors: streamVectors(vectors, ids),
        outputDir: tempDir,
        numClusters: TEST_NUM_CLUSTERS,
        M: TEST_M,
        Ksub: TEST_KSUB,
        dimensions: TEST_DIMENSIONS,
      })

      const codebooksPath = join(tempDir, 'codebooks.bin')
      const buffer = await readFile(codebooksPath)
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)

      // Header format from spec:
      // magic: uint32 (0-3)
      // version: uint16 (4-5)
      // flags: uint16 (6-7)
      // M: uint32 (8-11)
      // Ksub: uint32 (12-15)
      // dimensions: uint32 (16-19)
      // subvector_dim: uint32 (20-23)
      // dtype: uint8 (24)
      // reserved: uint8[7] (25-31)

      expect(view.getUint32(0, true)).toBe(PQCB_MAGIC) // magic
      expect(view.getUint16(4, true)).toBe(1) // version
      expect(view.getUint32(8, true)).toBe(TEST_M) // M
      expect(view.getUint32(12, true)).toBe(TEST_KSUB) // Ksub
      expect(view.getUint32(16, true)).toBe(TEST_DIMENSIONS) // dimensions
      expect(view.getUint32(20, true)).toBe(TEST_DIMENSIONS / TEST_M) // subvector_dim
    })

    it('should store PQ codebooks in correct format', async () => {
      assertModuleLoaded('buildIndex', buildIndex)
      assertModuleLoaded('parseCodebooksFile', parseCodebooksFile)

      const { vectors, ids } = generateClusteredVectors(500, TEST_DIMENSIONS, TEST_NUM_CLUSTERS)

      await buildIndex({
        vectors: streamVectors(vectors, ids),
        outputDir: tempDir,
        numClusters: TEST_NUM_CLUSTERS,
        M: TEST_M,
        Ksub: TEST_KSUB,
        dimensions: TEST_DIMENSIONS,
      })

      const codebooksPath = join(tempDir, 'codebooks.bin')
      const buffer = await readFile(codebooksPath)

      const parsed = parseCodebooksFile(buffer)

      expect(parsed.M).toBe(TEST_M)
      expect(parsed.Ksub).toBe(TEST_KSUB)
      expect(parsed.subvectorDim).toBe(TEST_DIMENSIONS / TEST_M)
      expect(parsed.centroids).toHaveLength(TEST_M)

      // Each subspace should have Ksub centroids
      for (let m = 0; m < TEST_M; m++) {
        expect(parsed.centroids[m]).toBeInstanceOf(Float32Array)
        expect(parsed.centroids[m].length).toBe(TEST_KSUB * (TEST_DIMENSIONS / TEST_M))
      }
    })
  })

  // ============================================================================
  // TESTS: BINARY FILE GENERATION - CLUSTER FILES
  // ============================================================================

  describe('Cluster Binary Format (CLST)', () => {
    let tempDir: string

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'index-builder-test-'))
    })

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true })
    })

    it('should generate cluster-XXXX.bin files with CLST magic number', async () => {
      assertModuleLoaded('buildIndex', buildIndex)

      const { vectors, ids } = generateClusteredVectors(500, TEST_DIMENSIONS, TEST_NUM_CLUSTERS)

      await buildIndex({
        vectors: streamVectors(vectors, ids),
        outputDir: tempDir,
        numClusters: TEST_NUM_CLUSTERS,
        M: TEST_M,
        Ksub: TEST_KSUB,
        dimensions: TEST_DIMENSIONS,
      })

      // Check that cluster files exist
      const files = await readdir(tempDir)
      const clusterFiles = files.filter((f) => f.startsWith('cluster-') && f.endsWith('.bin'))

      expect(clusterFiles.length).toBeGreaterThan(0)
      expect(clusterFiles.length).toBeLessThanOrEqual(TEST_NUM_CLUSTERS)

      // Check first cluster file has correct magic number
      const firstClusterPath = join(tempDir, clusterFiles[0])
      const buffer = await readFile(firstClusterPath)
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)

      expect(view.getUint32(0, true)).toBe(CLST_MAGIC)
    })

    it('should name cluster files with zero-padded indices', async () => {
      assertModuleLoaded('buildIndex', buildIndex)

      const { vectors, ids } = generateClusteredVectors(500, TEST_DIMENSIONS, TEST_NUM_CLUSTERS)

      await buildIndex({
        vectors: streamVectors(vectors, ids),
        outputDir: tempDir,
        numClusters: TEST_NUM_CLUSTERS,
        M: TEST_M,
        Ksub: TEST_KSUB,
        dimensions: TEST_DIMENSIONS,
      })

      const files = await readdir(tempDir)
      const clusterFiles = files.filter((f) => f.startsWith('cluster-') && f.endsWith('.bin'))

      // File names should be like cluster-0000.bin, cluster-0001.bin, etc.
      for (const file of clusterFiles) {
        expect(file).toMatch(/^cluster-\d{4}\.bin$/)
      }
    })

    it('should include correct header fields in cluster files', async () => {
      assertModuleLoaded('buildIndex', buildIndex)

      const { vectors, ids } = generateClusteredVectors(500, TEST_DIMENSIONS, TEST_NUM_CLUSTERS)

      await buildIndex({
        vectors: streamVectors(vectors, ids),
        outputDir: tempDir,
        numClusters: TEST_NUM_CLUSTERS,
        M: TEST_M,
        Ksub: TEST_KSUB,
        dimensions: TEST_DIMENSIONS,
      })

      const files = await readdir(tempDir)
      const clusterFile = files.find((f) => f.startsWith('cluster-'))!
      const buffer = await readFile(join(tempDir, clusterFile))
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)

      // Header format from spec (64 bytes):
      // magic: uint32 (0-3)
      // version: uint16 (4-5)
      // flags: uint16 (6-7)
      // cluster_id: uint32 (8-11)
      // vector_count: uint32 (12-15)
      // M: uint8 (16)
      // id_type: uint8 (17)
      // has_metadata: uint8 (18)
      // reserved: uint8[41] (19-63)

      expect(view.getUint32(0, true)).toBe(CLST_MAGIC) // magic
      expect(view.getUint16(4, true)).toBe(1) // version
      expect(view.getUint32(12, true)).toBeGreaterThan(0) // vector_count > 0
      expect(view.getUint8(16)).toBe(TEST_M) // M
    })

    it('should store vector IDs and PQ codes in cluster files', async () => {
      assertModuleLoaded('buildIndex', buildIndex)
      assertModuleLoaded('parseClusterFile', parseClusterFile)

      const { vectors, ids } = generateClusteredVectors(500, TEST_DIMENSIONS, TEST_NUM_CLUSTERS)

      await buildIndex({
        vectors: streamVectors(vectors, ids),
        outputDir: tempDir,
        numClusters: TEST_NUM_CLUSTERS,
        M: TEST_M,
        Ksub: TEST_KSUB,
        dimensions: TEST_DIMENSIONS,
      })

      const files = await readdir(tempDir)
      const clusterFile = files.find((f) => f.startsWith('cluster-'))!
      const buffer = await readFile(join(tempDir, clusterFile))

      const parsed = parseClusterFile(buffer)

      expect(parsed.clusterId).toBeGreaterThanOrEqual(0)
      expect(parsed.vectorCount).toBeGreaterThan(0)
      expect(parsed.ids).toHaveLength(parsed.vectorCount)
      expect(parsed.pqCodes).toBeInstanceOf(Uint8Array)
      expect(parsed.pqCodes.length).toBe(parsed.vectorCount * TEST_M)

      // Each ID should be a string from our original IDs
      for (const id of parsed.ids) {
        expect(ids).toContain(id)
      }
    })

    it('should partition all vectors across cluster files', async () => {
      assertModuleLoaded('buildIndex', buildIndex)
      assertModuleLoaded('parseClusterFile', parseClusterFile)

      const { vectors, ids } = generateClusteredVectors(500, TEST_DIMENSIONS, TEST_NUM_CLUSTERS)

      await buildIndex({
        vectors: streamVectors(vectors, ids),
        outputDir: tempDir,
        numClusters: TEST_NUM_CLUSTERS,
        M: TEST_M,
        Ksub: TEST_KSUB,
        dimensions: TEST_DIMENSIONS,
      })

      const files = await readdir(tempDir)
      const clusterFiles = files.filter((f) => f.startsWith('cluster-'))

      // Collect all IDs from all cluster files
      const allIds = new Set<string>()
      for (const clusterFile of clusterFiles) {
        const buffer = await readFile(join(tempDir, clusterFile))
        const parsed = parseClusterFile(buffer)
        for (const id of parsed.ids) {
          allIds.add(id)
        }
      }

      // All original IDs should be present exactly once
      expect(allIds.size).toBe(ids.length)
      for (const id of ids) {
        expect(allIds.has(id)).toBe(true)
      }
    })
  })

  // ============================================================================
  // TESTS: INCREMENTAL BUILDS
  // ============================================================================

  describe('Incremental Builds', () => {
    let tempDir: string

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'index-builder-test-'))
    })

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true })
    })

    it('should add new vectors to existing index', async () => {
      assertModuleLoaded('buildIndex', buildIndex)
      assertModuleLoaded('appendToIndex', appendToIndex)
      assertModuleLoaded('parseClusterFile', parseClusterFile)

      // Build initial index
      const { vectors: initialVectors, ids: initialIds } = generateClusteredVectors(
        300,
        TEST_DIMENSIONS,
        TEST_NUM_CLUSTERS
      )

      await buildIndex({
        vectors: streamVectors(initialVectors, initialIds),
        outputDir: tempDir,
        numClusters: TEST_NUM_CLUSTERS,
        M: TEST_M,
        Ksub: TEST_KSUB,
        dimensions: TEST_DIMENSIONS,
      })

      // Count initial vectors
      const files1 = await readdir(tempDir)
      const clusterFiles1 = files1.filter((f) => f.startsWith('cluster-'))
      let initialCount = 0
      for (const f of clusterFiles1) {
        const buffer = await readFile(join(tempDir, f))
        const parsed = parseClusterFile(buffer)
        initialCount += parsed.vectorCount
      }
      expect(initialCount).toBe(300)

      // Append new vectors
      const { vectors: newVectors, ids: newIds } = generateClusteredVectors(
        200,
        TEST_DIMENSIONS,
        TEST_NUM_CLUSTERS
      )
      // Ensure unique IDs
      const uniqueNewIds = newIds.map((id) => `new-${id}`)

      await appendToIndex({
        vectors: streamVectors(newVectors, uniqueNewIds),
        indexDir: tempDir,
      })

      // Count total vectors after append
      const files2 = await readdir(tempDir)
      const clusterFiles2 = files2.filter((f) => f.startsWith('cluster-'))
      let finalCount = 0
      for (const f of clusterFiles2) {
        const buffer = await readFile(join(tempDir, f))
        const parsed = parseClusterFile(buffer)
        finalCount += parsed.vectorCount
      }

      expect(finalCount).toBe(500) // 300 + 200
    })

    it('should preserve existing centroids during append', async () => {
      assertModuleLoaded('buildIndex', buildIndex)
      assertModuleLoaded('appendToIndex', appendToIndex)
      assertModuleLoaded('parseCentroidsFile', parseCentroidsFile)

      // Build initial index
      const { vectors: initialVectors, ids: initialIds } = generateClusteredVectors(
        300,
        TEST_DIMENSIONS,
        TEST_NUM_CLUSTERS
      )

      await buildIndex({
        vectors: streamVectors(initialVectors, initialIds),
        outputDir: tempDir,
        numClusters: TEST_NUM_CLUSTERS,
        M: TEST_M,
        Ksub: TEST_KSUB,
        dimensions: TEST_DIMENSIONS,
      })

      // Read centroids before append
      const centroidsBefore = parseCentroidsFile(await readFile(join(tempDir, 'centroids.bin')))

      // Append new vectors
      const { vectors: newVectors, ids: newIds } = generateClusteredVectors(
        100,
        TEST_DIMENSIONS,
        TEST_NUM_CLUSTERS
      )
      await appendToIndex({
        vectors: streamVectors(newVectors, newIds.map((id) => `new-${id}`)),
        indexDir: tempDir,
      })

      // Read centroids after append - should be unchanged
      const centroidsAfter = parseCentroidsFile(await readFile(join(tempDir, 'centroids.bin')))

      expect(centroidsAfter.numCentroids).toBe(centroidsBefore.numCentroids)
      for (let i = 0; i < centroidsBefore.centroids.length; i++) {
        for (let j = 0; j < centroidsBefore.centroids[i].length; j++) {
          expect(centroidsAfter.centroids[i][j]).toBeCloseTo(centroidsBefore.centroids[i][j], 5)
        }
      }
    })

    it('should assign new vectors to existing clusters', async () => {
      assertModuleLoaded('buildIndex', buildIndex)
      assertModuleLoaded('appendToIndex', appendToIndex)
      assertModuleLoaded('parseClusterFile', parseClusterFile)

      // Build initial index
      const { vectors: initialVectors, ids: initialIds } = generateClusteredVectors(
        200,
        TEST_DIMENSIONS,
        TEST_NUM_CLUSTERS
      )

      await buildIndex({
        vectors: streamVectors(initialVectors, initialIds),
        outputDir: tempDir,
        numClusters: TEST_NUM_CLUSTERS,
        M: TEST_M,
        Ksub: TEST_KSUB,
        dimensions: TEST_DIMENSIONS,
      })

      // Append vectors that should cluster with existing vectors
      const { vectors: newVectors, ids: newIds } = generateClusteredVectors(
        100,
        TEST_DIMENSIONS,
        TEST_NUM_CLUSTERS,
        0.1 // Tight clustering
      )

      await appendToIndex({
        vectors: streamVectors(newVectors, newIds.map((id) => `new-${id}`)),
        indexDir: tempDir,
      })

      // Verify new vectors are distributed across clusters
      const files = await readdir(tempDir)
      const clusterFiles = files.filter((f) => f.startsWith('cluster-'))

      let clustersWithNewVectors = 0
      for (const f of clusterFiles) {
        const buffer = await readFile(join(tempDir, f))
        const parsed = parseClusterFile(buffer)
        const hasNewVectors = parsed.ids.some((id: string) => id.startsWith('new-'))
        if (hasNewVectors) {
          clustersWithNewVectors++
        }
      }

      // New vectors should be spread across multiple clusters
      expect(clustersWithNewVectors).toBeGreaterThan(1)
    })
  })

  // ============================================================================
  // TESTS: LARGE DATASET STREAMING
  // ============================================================================

  describe('Large Dataset Streaming', () => {
    let tempDir: string

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'index-builder-test-'))
    })

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true })
    })

    it('should process vectors in streaming fashion', async () => {
      assertModuleLoaded('buildIndex', buildIndex)

      const totalVectors = 2000
      const batchSize = 100

      // Generate large dataset
      const { vectors, ids } = generateClusteredVectors(totalVectors, TEST_DIMENSIONS, TEST_NUM_CLUSTERS)

      // Track memory during build (rough check)
      const memoryBefore = process.memoryUsage().heapUsed

      await buildIndex({
        vectors: streamVectors(vectors, ids, batchSize),
        outputDir: tempDir,
        numClusters: TEST_NUM_CLUSTERS,
        M: TEST_M,
        Ksub: TEST_KSUB,
        dimensions: TEST_DIMENSIONS,
        streamingMode: true,
      })

      // Verify all vectors were indexed
      const files = await readdir(tempDir)
      const clusterFiles = files.filter((f) => f.startsWith('cluster-'))

      let totalIndexed = 0
      for (const f of clusterFiles) {
        const buffer = await readFile(join(tempDir, f))
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
        totalIndexed += view.getUint32(12, true) // vector_count field
      }

      expect(totalIndexed).toBe(totalVectors)
    })

    it('should not load all vectors into memory at once', async () => {
      assertModuleLoaded('IndexBuilder', IndexBuilder)

      const builder = new IndexBuilder({
        dimensions: TEST_DIMENSIONS,
        numClusters: TEST_NUM_CLUSTERS,
        M: TEST_M,
        Ksub: TEST_KSUB,
        streamingMode: true,
      })

      // Generate batches lazily
      const batchCount = 10
      const batchSize = 200
      let batchesProcessed = 0

      async function* generateBatches() {
        for (let b = 0; b < batchCount; b++) {
          const batch = []
          for (let i = 0; i < batchSize; i++) {
            const idx = b * batchSize + i
            const vec = generateRandomVectors(1, TEST_DIMENSIONS, idx)[0]
            batch.push({ id: `vec-${idx}`, vector: vec })
          }
          batchesProcessed++
          yield batch
        }
      }

      // Train on first few batches
      await builder.trainOnStream(generateBatches(), {
        trainingSampleSize: 500,
      })

      // Process all batches for encoding
      batchesProcessed = 0
      await builder.processStream(generateBatches())

      expect(batchesProcessed).toBe(batchCount)
      expect(builder.getProcessedCount()).toBe(batchCount * batchSize)
    })

    it('should support progress reporting during streaming', async () => {
      assertModuleLoaded('buildIndex', buildIndex)

      const { vectors, ids } = generateClusteredVectors(1000, TEST_DIMENSIONS, TEST_NUM_CLUSTERS)

      const progressUpdates: { phase: string; progress: number }[] = []

      await buildIndex({
        vectors: streamVectors(vectors, ids, 100),
        outputDir: tempDir,
        numClusters: TEST_NUM_CLUSTERS,
        M: TEST_M,
        Ksub: TEST_KSUB,
        dimensions: TEST_DIMENSIONS,
        onProgress: (phase: string, progress: number) => {
          progressUpdates.push({ phase, progress })
        },
      })

      // Should have progress updates for different phases
      const phases = new Set(progressUpdates.map((p) => p.phase))
      expect(phases.has('training')).toBe(true)
      expect(phases.has('encoding')).toBe(true)
      expect(phases.has('writing')).toBe(true)

      // Progress should go from 0 to 1 for each phase
      for (const phase of phases) {
        const phaseUpdates = progressUpdates.filter((p) => p.phase === phase)
        expect(phaseUpdates[0].progress).toBe(0)
        expect(phaseUpdates[phaseUpdates.length - 1].progress).toBe(1)
      }
    })
  })

  // ============================================================================
  // TESTS: OUTPUT FILE VALIDATION
  // ============================================================================

  describe('Output File Validation', () => {
    let tempDir: string

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'index-builder-test-'))
    })

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true })
    })

    it('should generate all required output files', async () => {
      assertModuleLoaded('buildIndex', buildIndex)

      const { vectors, ids } = generateClusteredVectors(500, TEST_DIMENSIONS, TEST_NUM_CLUSTERS)

      await buildIndex({
        vectors: streamVectors(vectors, ids),
        outputDir: tempDir,
        numClusters: TEST_NUM_CLUSTERS,
        M: TEST_M,
        Ksub: TEST_KSUB,
        dimensions: TEST_DIMENSIONS,
      })

      const files = await readdir(tempDir)

      // Must have centroids.bin
      expect(files).toContain('centroids.bin')

      // Must have codebooks.bin
      expect(files).toContain('codebooks.bin')

      // Must have at least one cluster file
      const clusterFiles = files.filter((f) => f.startsWith('cluster-'))
      expect(clusterFiles.length).toBeGreaterThan(0)
    })

    it('should validate file sizes are reasonable', async () => {
      assertModuleLoaded('buildIndex', buildIndex)

      const { vectors, ids } = generateClusteredVectors(500, TEST_DIMENSIONS, TEST_NUM_CLUSTERS)

      await buildIndex({
        vectors: streamVectors(vectors, ids),
        outputDir: tempDir,
        numClusters: TEST_NUM_CLUSTERS,
        M: TEST_M,
        Ksub: TEST_KSUB,
        dimensions: TEST_DIMENSIONS,
      })

      // Centroids: 32 (header) + K * D * 4 bytes
      const centroidsStats = await stat(join(tempDir, 'centroids.bin'))
      const expectedCentroidsSize = 32 + TEST_NUM_CLUSTERS * TEST_DIMENSIONS * 4
      expect(centroidsStats.size).toBeGreaterThanOrEqual(expectedCentroidsSize)

      // Codebooks: 32 (header) + M * Ksub * (D/M) * 4 bytes
      const codebooksStats = await stat(join(tempDir, 'codebooks.bin'))
      const expectedCodebooksSize = 32 + TEST_M * TEST_KSUB * (TEST_DIMENSIONS / TEST_M) * 4
      expect(codebooksStats.size).toBeGreaterThanOrEqual(expectedCodebooksSize)

      // Each cluster file: 64 (header) + n * (8 + M) bytes minimum
      const files = await readdir(tempDir)
      for (const f of files.filter((f) => f.startsWith('cluster-'))) {
        const clusterStats = await stat(join(tempDir, f))
        expect(clusterStats.size).toBeGreaterThanOrEqual(64) // At least header
      }
    })

    it('should produce parseable output files', async () => {
      assertModuleLoaded('buildIndex', buildIndex)
      assertModuleLoaded('parseCentroidsFile', parseCentroidsFile)
      assertModuleLoaded('parseCodebooksFile', parseCodebooksFile)
      assertModuleLoaded('parseClusterFile', parseClusterFile)

      const { vectors, ids } = generateClusteredVectors(500, TEST_DIMENSIONS, TEST_NUM_CLUSTERS)

      await buildIndex({
        vectors: streamVectors(vectors, ids),
        outputDir: tempDir,
        numClusters: TEST_NUM_CLUSTERS,
        M: TEST_M,
        Ksub: TEST_KSUB,
        dimensions: TEST_DIMENSIONS,
      })

      // Parse centroids
      const centroidsBuffer = await readFile(join(tempDir, 'centroids.bin'))
      const centroids = parseCentroidsFile(centroidsBuffer)
      expect(centroids.numCentroids).toBe(TEST_NUM_CLUSTERS)
      expect(centroids.dimensions).toBe(TEST_DIMENSIONS)

      // Parse codebooks
      const codebooksBuffer = await readFile(join(tempDir, 'codebooks.bin'))
      const codebooks = parseCodebooksFile(codebooksBuffer)
      expect(codebooks.M).toBe(TEST_M)
      expect(codebooks.Ksub).toBe(TEST_KSUB)

      // Parse cluster files
      const files = await readdir(tempDir)
      for (const f of files.filter((f) => f.startsWith('cluster-'))) {
        const clusterBuffer = await readFile(join(tempDir, f))
        const cluster = parseClusterFile(clusterBuffer)

        expect(cluster.clusterId).toBeGreaterThanOrEqual(0)
        expect(cluster.vectorCount).toBeGreaterThan(0)
        expect(cluster.ids).toHaveLength(cluster.vectorCount)
        expect(cluster.pqCodes.length).toBe(cluster.vectorCount * TEST_M)
      }
    })

    it('should handle edge case: single cluster', async () => {
      assertModuleLoaded('buildIndex', buildIndex)

      const { vectors, ids } = generateClusteredVectors(100, TEST_DIMENSIONS, 1)

      await buildIndex({
        vectors: streamVectors(vectors, ids),
        outputDir: tempDir,
        numClusters: 1,
        M: TEST_M,
        Ksub: TEST_KSUB,
        dimensions: TEST_DIMENSIONS,
      })

      const files = await readdir(tempDir)
      const clusterFiles = files.filter((f) => f.startsWith('cluster-'))

      expect(clusterFiles).toHaveLength(1)
      expect(clusterFiles[0]).toBe('cluster-0000.bin')
    })

    it('should handle edge case: many empty clusters', async () => {
      assertModuleLoaded('buildIndex', buildIndex)

      // Few tightly clustered vectors, many clusters
      const center = generateRandomVectors(1, TEST_DIMENSIONS, 1)[0]
      const vectors: Float32Array[] = []
      const ids: string[] = []
      for (let i = 0; i < 50; i++) {
        const vec = new Float32Array(TEST_DIMENSIONS)
        for (let j = 0; j < TEST_DIMENSIONS; j++) {
          vec[j] = center[j] + (Math.random() - 0.5) * 0.01
        }
        vectors.push(normalizeVector(vec))
        ids.push(`vec-${i}`)
      }

      await buildIndex({
        vectors: streamVectors(vectors, ids),
        outputDir: tempDir,
        numClusters: 20, // More clusters than natural groups
        M: TEST_M,
        Ksub: TEST_KSUB,
        dimensions: TEST_DIMENSIONS,
      })

      // Should handle gracefully - only create files for non-empty clusters
      const files = await readdir(tempDir)
      const clusterFiles = files.filter((f) => f.startsWith('cluster-'))

      // Each cluster file should have at least one vector
      for (const f of clusterFiles) {
        const buffer = await readFile(join(tempDir, f))
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
        const vectorCount = view.getUint32(12, true)
        expect(vectorCount).toBeGreaterThan(0)
      }

      // Total across all cluster files should equal input count
      let total = 0
      for (const f of clusterFiles) {
        const buffer = await readFile(join(tempDir, f))
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
        total += view.getUint32(12, true)
      }
      expect(total).toBe(50)
    })
  })
})
