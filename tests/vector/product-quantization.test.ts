/**
 * Product Quantization (PQ) Tests
 *
 * Tests for Product Quantization encoder/decoder, a vector compression technique
 * that splits vectors into subvectors and quantizes each independently.
 *
 * PQ works by:
 * 1. Splitting D-dimensional vectors into M subvectors of D/M dimensions each
 * 2. Training K centroids per subvector (typically K=256 for 8-bit codes)
 * 3. Encoding vectors as M indices (one per subvector) into the codebook
 * 4. Computing distances efficiently using precomputed lookup tables
 *
 * Compression ratio: D * 4 bytes (float32) -> M bytes (uint8 codes)
 * Example: 768-dim float32 (3072 bytes) -> 48 uint8 codes (48 bytes) = 64x compression
 *
 * @module tests/vector/product-quantization.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import type { PQCodebook } from '../../types/vector'

// ============================================================================
// MODULE IMPORTS (will fail until implementation exists)
// ============================================================================

// These imports will fail until the module is implemented
// This is the expected behavior for TDD - tests define the API contract
let ProductQuantization: any
let PQEncoder: any
let trainPQCodebook: any
let encodePQ: any
let decodePQ: any
let asymmetricDistance: any
let symmetricDistance: any
let serializeCodebook: any
let deserializeCodebook: any

// Attempt to load the module - will fail until implemented
beforeEach(async () => {
  try {
    const pqModule = await import('../../db/edgevec/pq')
    ProductQuantization = pqModule.ProductQuantization
    PQEncoder = pqModule.PQEncoder
    trainPQCodebook = pqModule.trainPQCodebook
    encodePQ = pqModule.encodePQ
    decodePQ = pqModule.decodePQ
    asymmetricDistance = pqModule.asymmetricDistance
    symmetricDistance = pqModule.symmetricDistance
    serializeCodebook = pqModule.serializeCodebook
    deserializeCodebook = pqModule.deserializeCodebook
  } catch {
    // Module not yet implemented - tests will fail with clear message
    ProductQuantization = undefined
    PQEncoder = undefined
    trainPQCodebook = undefined
    encodePQ = undefined
    decodePQ = undefined
    asymmetricDistance = undefined
    symmetricDistance = undefined
    serializeCodebook = undefined
    deserializeCodebook = undefined
  }
})

// ============================================================================
// TEST UTILITIES
// ============================================================================

/**
 * Generate random vectors for training/testing
 */
function generateRandomVectors(count: number, dimensions: number): Float32Array[] {
  return Array.from({ length: count }, () => {
    const vec = new Float32Array(dimensions)
    for (let i = 0; i < dimensions; i++) {
      vec[i] = Math.random() * 2 - 1 // Uniform [-1, 1]
    }
    return vec
  })
}

/**
 * Generate clustered vectors (for more realistic training data)
 */
function generateClusteredVectors(
  count: number,
  dimensions: number,
  numClusters: number
): Float32Array[] {
  const vectors: Float32Array[] = []
  const clusterCenters = generateRandomVectors(numClusters, dimensions)

  for (let i = 0; i < count; i++) {
    const centerIdx = i % numClusters
    const center = clusterCenters[centerIdx]
    const vec = new Float32Array(dimensions)

    // Add noise around cluster center
    for (let j = 0; j < dimensions; j++) {
      vec[j] = center[j] + (Math.random() - 0.5) * 0.2
    }
    vectors.push(vec)
  }

  return vectors
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
 * Compute mean squared error between two vectors
 */
function mse(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i]
    sum += diff * diff
  }
  return sum / a.length
}

/**
 * Helper to assert module is loaded
 */
function assertModuleLoaded(fnName: string, fn: any): asserts fn {
  if (!fn) {
    throw new Error(
      `PQ module not implemented. Expected function '${fnName}' from 'db/edgevec/pq'. ` +
        `Create the module to make this test pass.`
    )
  }
}

// ============================================================================
// CODEBOOK TRAINING TESTS
// ============================================================================

describe('ProductQuantization', () => {
  describe('Codebook Training', () => {
    it('should train codebook from sample vectors', async () => {
      assertModuleLoaded('trainPQCodebook', trainPQCodebook)

      const dimensions = 128
      const M = 8 // Number of subvectors
      const K = 256 // Centroids per subvector

      const trainingVectors = generateClusteredVectors(1000, dimensions, 50)

      const codebook = await trainPQCodebook(trainingVectors, {
        numSubquantizers: M,
        numCentroids: K,
      })

      // Verify codebook structure
      expect(codebook).toBeDefined()
      expect(codebook.numSubquantizers).toBe(M)
      expect(codebook.numCentroids).toBe(K)
      expect(codebook.subvectorDimension).toBe(dimensions / M)

      // Verify centroids are populated
      expect(codebook.centroids).toHaveLength(M)
      for (let m = 0; m < M; m++) {
        // Each subquantizer has K centroids of (D/M) dimensions
        expect(codebook.centroids[m]).toBeInstanceOf(Float32Array)
        expect(codebook.centroids[m].length).toBe(K * (dimensions / M))
      }
    })

    it('should support different subvector counts (M=8, 16, 32, 64)', async () => {
      assertModuleLoaded('trainPQCodebook', trainPQCodebook)

      const dimensions = 128
      const K = 256
      const trainingVectors = generateRandomVectors(500, dimensions)

      for (const M of [8, 16, 32, 64]) {
        const codebook = await trainPQCodebook(trainingVectors, {
          numSubquantizers: M,
          numCentroids: K,
        })

        expect(codebook.numSubquantizers).toBe(M)
        expect(codebook.subvectorDimension).toBe(dimensions / M)
        expect(codebook.centroids).toHaveLength(M)
      }
    })

    it('should throw error when dimensions not divisible by M', async () => {
      assertModuleLoaded('trainPQCodebook', trainPQCodebook)

      const dimensions = 100
      const M = 8 // 100 is not divisible by 8
      const trainingVectors = generateRandomVectors(100, dimensions)

      await expect(
        trainPQCodebook(trainingVectors, {
          numSubquantizers: M,
          numCentroids: 256,
        })
      ).rejects.toThrow(/dimension.*divisible/i)
    })

    it('should throw error with insufficient training vectors', async () => {
      assertModuleLoaded('trainPQCodebook', trainPQCodebook)

      const dimensions = 128
      const M = 8
      const K = 256
      // Need at least K vectors per subquantizer for good training
      const trainingVectors = generateRandomVectors(10, dimensions)

      await expect(
        trainPQCodebook(trainingVectors, {
          numSubquantizers: M,
          numCentroids: K,
        })
      ).rejects.toThrow(/insufficient.*training/i)
    })
  })

  // ============================================================================
  // ENCODING TESTS
  // ============================================================================

  describe('Vector Encoding', () => {
    const dimensions = 128
    const M = 8
    const K = 256
    let codebook: PQCodebook

    beforeEach(async () => {
      if (!trainPQCodebook) return
      const trainingVectors = generateClusteredVectors(1000, dimensions, 50)
      codebook = await trainPQCodebook(trainingVectors, {
        numSubquantizers: M,
        numCentroids: K,
      })
    })

    it('should encode vector into PQ codes', async () => {
      assertModuleLoaded('encodePQ', encodePQ)

      const vector = generateRandomVectors(1, dimensions)[0]

      const codes = encodePQ(vector, codebook)

      // Should produce M codes
      expect(codes).toBeInstanceOf(Uint8Array)
      expect(codes.length).toBe(M)

      // Each code should be in range [0, K-1]
      for (let m = 0; m < M; m++) {
        expect(codes[m]).toBeGreaterThanOrEqual(0)
        expect(codes[m]).toBeLessThan(K)
      }
    })

    it('should split vector into M subvectors', () => {
      assertModuleLoaded('ProductQuantization', ProductQuantization)

      const vector = new Float32Array(dimensions)
      for (let i = 0; i < dimensions; i++) {
        vector[i] = i // Simple test pattern
      }

      const pq = new ProductQuantization(codebook)
      const subvectors = pq.splitIntoSubvectors(vector)

      expect(subvectors).toHaveLength(M)

      const subDim = dimensions / M
      for (let m = 0; m < M; m++) {
        expect(subvectors[m]).toBeInstanceOf(Float32Array)
        expect(subvectors[m].length).toBe(subDim)

        // Verify correct slice of original vector
        for (let d = 0; d < subDim; d++) {
          expect(subvectors[m][d]).toBe(vector[m * subDim + d])
        }
      }
    })

    it('should use K centroids per subvector (default 256)', () => {
      assertModuleLoaded('encodePQ', encodePQ)

      expect(codebook.numCentroids).toBe(256)

      // Verify each code is stored as uint8 (max 256 values)
      const vector = generateRandomVectors(1, dimensions)[0]
      const codes = encodePQ(vector, codebook)

      expect(codes).toBeInstanceOf(Uint8Array)
    })

    it('should encode batch of vectors efficiently', async () => {
      assertModuleLoaded('ProductQuantization', ProductQuantization)

      const vectors = generateRandomVectors(100, dimensions)
      const pq = new ProductQuantization(codebook)

      const allCodes = pq.encodeBatch(vectors)

      expect(allCodes).toHaveLength(100)
      for (const codes of allCodes) {
        expect(codes).toBeInstanceOf(Uint8Array)
        expect(codes.length).toBe(M)
      }
    })

    it('should throw error for wrong dimension', () => {
      assertModuleLoaded('encodePQ', encodePQ)

      const wrongDimVector = new Float32Array(64) // Wrong dimension

      expect(() => encodePQ(wrongDimVector, codebook)).toThrow(/dimension/i)
    })
  })

  // ============================================================================
  // DECODING TESTS
  // ============================================================================

  describe('Vector Decoding', () => {
    const dimensions = 128
    const M = 8
    const K = 256
    let codebook: PQCodebook

    beforeEach(async () => {
      if (!trainPQCodebook) return
      const trainingVectors = generateClusteredVectors(1000, dimensions, 50)
      codebook = await trainPQCodebook(trainingVectors, {
        numSubquantizers: M,
        numCentroids: K,
      })
    })

    it('should decode PQ codes back to approximate vector', () => {
      assertModuleLoaded('encodePQ', encodePQ)
      assertModuleLoaded('decodePQ', decodePQ)

      const originalVector = generateRandomVectors(1, dimensions)[0]

      const codes = encodePQ(originalVector, codebook)
      const reconstructed = decodePQ(codes, codebook)

      // Should produce correct dimension
      expect(reconstructed).toBeInstanceOf(Float32Array)
      expect(reconstructed.length).toBe(dimensions)

      // Should be approximate (not exact due to quantization)
      const error = mse(originalVector, reconstructed)

      // MSE should be reasonable (depends on training, but should be finite)
      expect(error).toBeLessThan(1.0) // Rough threshold
      expect(error).toBeGreaterThan(0) // Not exact match
    })

    it('should maintain relative distances after encode/decode', async () => {
      assertModuleLoaded('ProductQuantization', ProductQuantization)
      assertModuleLoaded('encodePQ', encodePQ)
      assertModuleLoaded('decodePQ', decodePQ)

      const vectors = generateClusteredVectors(100, dimensions, 10)
      const query = vectors[0]

      // Compute original distances
      const originalDistances = vectors.map((v) => l2Distance(query, v))

      // Encode and decode all vectors
      const reconstructed = vectors.map((v) => {
        const codes = encodePQ(v, codebook)
        return decodePQ(codes, codebook)
      })

      // Compute reconstructed distances
      const reconstructedDistances = reconstructed.map((v) => l2Distance(query, v))

      // Check correlation (relative ordering preserved)
      // Sort indices by distance
      const originalOrder = originalDistances
        .map((d, i) => ({ d, i }))
        .sort((a, b) => a.d - b.d)
        .map((x) => x.i)

      const reconstructedOrder = reconstructedDistances
        .map((d, i) => ({ d, i }))
        .sort((a, b) => a.d - b.d)
        .map((x) => x.i)

      // Top 10 should have significant overlap
      const topOriginal = new Set(originalOrder.slice(0, 10))
      const topReconstructed = new Set(reconstructedOrder.slice(0, 10))

      const overlap = [...topOriginal].filter((x) => topReconstructed.has(x)).length
      expect(overlap).toBeGreaterThanOrEqual(5) // At least 50% overlap
    })
  })

  // ============================================================================
  // DISTANCE COMPUTATION TESTS
  // ============================================================================

  describe('Distance Computation', () => {
    const dimensions = 128
    const M = 8
    const K = 256
    let codebook: PQCodebook

    beforeEach(async () => {
      if (!trainPQCodebook) return
      const trainingVectors = generateClusteredVectors(1000, dimensions, 50)
      codebook = await trainPQCodebook(trainingVectors, {
        numSubquantizers: M,
        numCentroids: K,
      })
    })

    it('should compute asymmetric distance (query vs PQ codes)', () => {
      assertModuleLoaded('encodePQ', encodePQ)
      assertModuleLoaded('asymmetricDistance', asymmetricDistance)

      const query = generateRandomVectors(1, dimensions)[0]
      const databaseVector = generateRandomVectors(1, dimensions)[0]
      const codes = encodePQ(databaseVector, codebook)

      // Asymmetric distance: exact query vs quantized database vector
      const distance = asymmetricDistance(query, codes, codebook)

      // Should return a positive number
      expect(typeof distance).toBe('number')
      expect(distance).toBeGreaterThanOrEqual(0)
      expect(Number.isFinite(distance)).toBe(true)
    })

    it('should compute asymmetric distance using lookup tables', () => {
      assertModuleLoaded('ProductQuantization', ProductQuantization)
      assertModuleLoaded('encodePQ', encodePQ)

      const query = generateRandomVectors(1, dimensions)[0]
      const pq = new ProductQuantization(codebook)

      // Precompute distance table (optimization for batch queries)
      const distanceTable = pq.computeDistanceTable(query)

      // Table should have M rows and K columns
      expect(distanceTable).toHaveLength(M)
      for (let m = 0; m < M; m++) {
        expect(distanceTable[m]).toHaveLength(K)
      }

      // Use table for fast distance computation
      const codes = encodePQ(generateRandomVectors(1, dimensions)[0], codebook)
      const distance = pq.distanceFromTable(distanceTable, codes)

      expect(typeof distance).toBe('number')
      expect(distance).toBeGreaterThanOrEqual(0)
    })

    it('should compute symmetric distance (PQ codes vs PQ codes)', () => {
      assertModuleLoaded('encodePQ', encodePQ)
      assertModuleLoaded('symmetricDistance', symmetricDistance)

      const vector1 = generateRandomVectors(1, dimensions)[0]
      const vector2 = generateRandomVectors(1, dimensions)[0]

      const codes1 = encodePQ(vector1, codebook)
      const codes2 = encodePQ(vector2, codebook)

      // Symmetric distance: both vectors are quantized
      const distance = symmetricDistance(codes1, codes2, codebook)

      // Should return a positive number
      expect(typeof distance).toBe('number')
      expect(distance).toBeGreaterThanOrEqual(0)
      expect(Number.isFinite(distance)).toBe(true)
    })

    it('should have symmetric distance = 0 for identical codes', () => {
      assertModuleLoaded('encodePQ', encodePQ)
      assertModuleLoaded('symmetricDistance', symmetricDistance)

      const vector = generateRandomVectors(1, dimensions)[0]
      const codes = encodePQ(vector, codebook)

      const distance = symmetricDistance(codes, codes, codebook)

      expect(distance).toBe(0)
    })

    it('should approximate L2 distance accurately', async () => {
      assertModuleLoaded('encodePQ', encodePQ)
      assertModuleLoaded('asymmetricDistance', asymmetricDistance)

      const vectors = generateRandomVectors(50, dimensions)
      const query = vectors[0]

      let totalError = 0
      for (let i = 1; i < vectors.length; i++) {
        const exactDistance = l2Distance(query, vectors[i])
        const codes = encodePQ(vectors[i], codebook)
        const approxDistance = asymmetricDistance(query, codes, codebook)

        // Relative error
        const relativeError = Math.abs(exactDistance - approxDistance) / (exactDistance + 1e-6)
        totalError += relativeError
      }

      const avgRelativeError = totalError / (vectors.length - 1)
      // Average relative error should be reasonable
      expect(avgRelativeError).toBeLessThan(0.5) // 50% average error tolerance
    })
  })

  // ============================================================================
  // SERIALIZATION TESTS
  // ============================================================================

  describe('Codebook Serialization', () => {
    const dimensions = 128
    const M = 8
    const K = 256
    let codebook: PQCodebook

    beforeEach(async () => {
      if (!trainPQCodebook) return
      const trainingVectors = generateClusteredVectors(1000, dimensions, 50)
      codebook = await trainPQCodebook(trainingVectors, {
        numSubquantizers: M,
        numCentroids: K,
      })
    })

    it('should serialize/deserialize codebook', () => {
      assertModuleLoaded('serializeCodebook', serializeCodebook)
      assertModuleLoaded('deserializeCodebook', deserializeCodebook)

      const serialized = serializeCodebook(codebook)

      // Should return ArrayBuffer
      expect(serialized).toBeInstanceOf(ArrayBuffer)
      expect(serialized.byteLength).toBeGreaterThan(0)

      // Deserialize
      const restored = deserializeCodebook(serialized)

      // Verify restored codebook matches original
      expect(restored.numSubquantizers).toBe(codebook.numSubquantizers)
      expect(restored.numCentroids).toBe(codebook.numCentroids)
      expect(restored.subvectorDimension).toBe(codebook.subvectorDimension)

      // Verify centroids match
      expect(restored.centroids).toHaveLength(codebook.centroids.length)
      for (let m = 0; m < M; m++) {
        expect(restored.centroids[m].length).toBe(codebook.centroids[m].length)
        for (let i = 0; i < codebook.centroids[m].length; i++) {
          expect(restored.centroids[m][i]).toBeCloseTo(codebook.centroids[m][i], 5)
        }
      }
    })

    it('should produce identical encoding after deserialization', () => {
      assertModuleLoaded('encodePQ', encodePQ)
      assertModuleLoaded('serializeCodebook', serializeCodebook)
      assertModuleLoaded('deserializeCodebook', deserializeCodebook)

      const vector = generateRandomVectors(1, dimensions)[0]

      // Encode with original codebook
      const originalCodes = encodePQ(vector, codebook)

      // Serialize and deserialize
      const serialized = serializeCodebook(codebook)
      const restored = deserializeCodebook(serialized)

      // Encode with restored codebook
      const restoredCodes = encodePQ(vector, restored)

      // Codes should be identical
      expect(restoredCodes).toEqual(originalCodes)
    })

    it('should calculate serialized size correctly', () => {
      assertModuleLoaded('ProductQuantization', ProductQuantization)
      assertModuleLoaded('serializeCodebook', serializeCodebook)

      const pq = new ProductQuantization(codebook)
      const expectedSize = pq.getSerializedSize()
      const serialized = serializeCodebook(codebook)

      expect(serialized.byteLength).toBe(expectedSize)
    })
  })

  // ============================================================================
  // COMPRESSION RATIO TESTS
  // ============================================================================

  describe('Compression Ratio', () => {
    it('should provide compression ratio calculation', async () => {
      assertModuleLoaded('trainPQCodebook', trainPQCodebook)
      assertModuleLoaded('ProductQuantization', ProductQuantization)

      const dimensions = 768 // Common embedding dimension
      const M = 48 // Subvectors
      const K = 256

      const trainingVectors = generateRandomVectors(500, dimensions)
      const codebook = await trainPQCodebook(trainingVectors, {
        numSubquantizers: M,
        numCentroids: K,
      })

      const pq = new ProductQuantization(codebook)
      const compressionRatio = pq.getCompressionRatio()

      // Original: D * 4 bytes (float32)
      // Compressed: M bytes (uint8 codes)
      // Ratio: D * 4 / M
      const expectedRatio = (dimensions * 4) / M

      expect(compressionRatio).toBeCloseTo(expectedRatio, 1)
    })

    it('should report memory savings correctly', async () => {
      assertModuleLoaded('trainPQCodebook', trainPQCodebook)
      assertModuleLoaded('ProductQuantization', ProductQuantization)

      const dimensions = 128
      const M = 8

      const trainingVectors = generateRandomVectors(500, dimensions)
      const codebook = await trainPQCodebook(trainingVectors, {
        numSubquantizers: M,
        numCentroids: 256,
      })

      const pq = new ProductQuantization(codebook)

      // For 1 million vectors
      const vectorCount = 1_000_000
      const originalSize = vectorCount * dimensions * 4 // float32
      const compressedSize = vectorCount * M // uint8 codes

      const stats = pq.getMemoryStats(vectorCount)

      expect(stats.originalBytes).toBe(originalSize)
      expect(stats.compressedBytes).toBe(compressedSize)
      expect(stats.savedBytes).toBe(originalSize - compressedSize)
      expect(stats.compressionRatio).toBeCloseTo(originalSize / compressedSize, 1)
    })
  })

  // ============================================================================
  // RESIDUAL PQ TESTS
  // ============================================================================

  describe('Residual PQ', () => {
    it('should handle residual PQ (after coarse quantization)', async () => {
      assertModuleLoaded('trainPQCodebook', trainPQCodebook)
      assertModuleLoaded('encodePQ', encodePQ)
      assertModuleLoaded('decodePQ', decodePQ)

      const dimensions = 128
      const M = 8
      const K = 256
      const nCoarseCentroids = 100

      // Train coarse quantizer (IVF centroids)
      const trainingVectors = generateClusteredVectors(2000, dimensions, nCoarseCentroids)

      // First, create coarse centroids (simplified - just use k-means in real impl)
      const coarseCentroids = trainingVectors.slice(0, nCoarseCentroids)

      // Find nearest coarse centroid for each training vector
      function findNearestCentroid(
        vector: Float32Array,
        centroids: Float32Array[]
      ): { index: number; centroid: Float32Array } {
        let minDist = Infinity
        let minIdx = 0
        for (let i = 0; i < centroids.length; i++) {
          const dist = l2Distance(vector, centroids[i])
          if (dist < minDist) {
            minDist = dist
            minIdx = i
          }
        }
        return { index: minIdx, centroid: centroids[minIdx] }
      }

      // Compute residuals
      const residuals: Float32Array[] = trainingVectors.map((vec) => {
        const { centroid } = findNearestCentroid(vec, coarseCentroids)
        const residual = new Float32Array(dimensions)
        for (let i = 0; i < dimensions; i++) {
          residual[i] = vec[i] - centroid[i]
        }
        return residual
      })

      // Train PQ on residuals
      const residualCodebook = await trainPQCodebook(residuals, {
        numSubquantizers: M,
        numCentroids: K,
      })

      // Encode a test vector with residual PQ
      const testVector = generateRandomVectors(1, dimensions)[0]
      const { centroid } = findNearestCentroid(testVector, coarseCentroids)

      // Compute residual
      const residual = new Float32Array(dimensions)
      for (let i = 0; i < dimensions; i++) {
        residual[i] = testVector[i] - centroid[i]
      }

      // Encode residual
      const codes = encodePQ(residual, residualCodebook)

      expect(codes).toBeInstanceOf(Uint8Array)
      expect(codes.length).toBe(M)

      // Decode and reconstruct
      const decodedResidual = decodePQ(codes, residualCodebook)
      const reconstructed = new Float32Array(dimensions)
      for (let i = 0; i < dimensions; i++) {
        reconstructed[i] = centroid[i] + decodedResidual[i]
      }

      // Reconstruction error should be small
      const error = l2Distance(testVector, reconstructed)
      expect(error).toBeLessThan(l2Distance(testVector, centroid)) // Should be better than just coarse
    })
  })

  // ============================================================================
  // ENCODER CLASS TESTS
  // ============================================================================

  describe('PQEncoder Class', () => {
    it('should create encoder from trained codebook', async () => {
      assertModuleLoaded('trainPQCodebook', trainPQCodebook)
      assertModuleLoaded('PQEncoder', PQEncoder)

      const dimensions = 128
      const M = 8

      const trainingVectors = generateRandomVectors(500, dimensions)
      const codebook = await trainPQCodebook(trainingVectors, {
        numSubquantizers: M,
        numCentroids: 256,
      })

      const encoder = new PQEncoder(codebook)

      expect(encoder).toBeDefined()
      expect(encoder.dimensions).toBe(dimensions)
      expect(encoder.numSubquantizers).toBe(M)
      expect(encoder.codeSize).toBe(M)
    })

    it('should provide encode/decode methods', async () => {
      assertModuleLoaded('trainPQCodebook', trainPQCodebook)
      assertModuleLoaded('PQEncoder', PQEncoder)

      const dimensions = 128
      const M = 8

      const trainingVectors = generateRandomVectors(500, dimensions)
      const codebook = await trainPQCodebook(trainingVectors, {
        numSubquantizers: M,
        numCentroids: 256,
      })

      const encoder = new PQEncoder(codebook)
      const vector = generateRandomVectors(1, dimensions)[0]

      const codes = encoder.encode(vector)
      expect(codes).toBeInstanceOf(Uint8Array)
      expect(codes.length).toBe(M)

      const decoded = encoder.decode(codes)
      expect(decoded).toBeInstanceOf(Float32Array)
      expect(decoded.length).toBe(dimensions)
    })
  })
})
