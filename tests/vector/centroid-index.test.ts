/**
 * Centroid Index Tests - Static Asset Coarse Search
 *
 * RED phase TDD tests for the CentroidIndex component that loads cluster
 * centroids from static assets (CENT binary format) and performs coarse
 * nearest neighbor search to identify candidate clusters.
 *
 * The CentroidIndex is the first stage of IVF-based vector search:
 * 1. Load K centroids from a binary CENT file (static asset)
 * 2. Find top-nprobe nearest centroids for a query vector
 * 3. Return cluster IDs with distances for downstream PQ search
 *
 * Binary format (CENT):
 * - Header (32 bytes):
 *   - magic: uint32 = 0x43454E54 ("CENT")
 *   - version: uint16 = 1
 *   - flags: uint16 = 0
 *   - num_centroids: uint32
 *   - dimensions: uint32
 *   - dtype: uint8 (0 = float32, 1 = float16)
 *   - metric: uint8 (0 = cosine, 1 = l2, 2 = dot)
 *   - reserved: uint8[10]
 * - Centroid data: num_centroids * dimensions * sizeof(dtype)
 *
 * Tests should FAIL until CentroidIndex is implemented.
 *
 * @see docs/plans/static-assets-vector-search.md
 * @module tests/vector/centroid-index.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { DistanceMetric } from '../../types/vector'

// ============================================================================
// MODULE IMPORTS (will fail until implementation exists)
// ============================================================================

// These imports will fail until the module is implemented
// This is the expected behavior for TDD - tests define the API contract
let CentroidIndex: any
let parseCentroidFile: any
let serializeCentroidFile: any
let CentroidIndexConfig: any

// Attempt to load the module - will fail until implemented
beforeEach(async () => {
  try {
    const centroidModule = await import('../../db/edgevec/centroid-index')
    CentroidIndex = centroidModule.CentroidIndex
    parseCentroidFile = centroidModule.parseCentroidFile
    serializeCentroidFile = centroidModule.serializeCentroidFile
    CentroidIndexConfig = centroidModule.CentroidIndexConfig
  } catch {
    // Module not yet implemented - tests will fail with clear message
    CentroidIndex = undefined
    parseCentroidFile = undefined
    serializeCentroidFile = undefined
    CentroidIndexConfig = undefined
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
      `CentroidIndex module not implemented. Expected '${fnName}' from 'db/edgevec/centroid-index'. ` +
        `Create the module to make this test pass.`
    )
  }
}

/**
 * Create a normalized unit vector
 */
function normalizeVector(v: Float32Array): Float32Array {
  let norm = 0
  for (let i = 0; i < v.length; i++) {
    norm += v[i] * v[i]
  }
  norm = Math.sqrt(norm)

  const result = new Float32Array(v.length)
  if (norm > 0) {
    for (let i = 0; i < v.length; i++) {
      result[i] = v[i] / norm
    }
  }
  return result
}

/**
 * Create a random vector with optional seed for reproducibility
 */
function randomVector(dimensions: number, seed?: number): Float32Array {
  const vec = new Float32Array(dimensions)
  // Simple PRNG for reproducibility
  let s = seed ?? Math.random() * 10000
  for (let i = 0; i < dimensions; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    vec[i] = (s / 0x7fffffff) * 2 - 1 // Range [-1, 1]
  }
  return normalizeVector(vec)
}

/**
 * Calculate cosine similarity between two vectors
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
 * Calculate L2 distance between two vectors
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
 * Brute force nearest centroid search for ground truth
 */
function bruteForceNearestCentroids(
  query: Float32Array,
  centroids: Float32Array[],
  k: number,
  metric: DistanceMetric = 'cosine'
): Array<{ clusterId: number; distance: number }> {
  const distances = centroids.map((centroid, i) => ({
    clusterId: i,
    distance: metric === 'cosine'
      ? 1 - cosineSimilarity(query, centroid)
      : l2Distance(query, centroid),
  }))

  // Sort ascending by distance (lower is better)
  distances.sort((a, b) => a.distance - b.distance)
  return distances.slice(0, k)
}

/**
 * Create mock centroid data in CENT binary format
 */
function createMockCentroidFile(
  numCentroids: number,
  dimensions: number,
  metric: DistanceMetric = 'cosine',
  useFloat16: boolean = false
): { buffer: ArrayBuffer; centroids: Float32Array[] } {
  // Create random centroids
  const centroids: Float32Array[] = []
  for (let i = 0; i < numCentroids; i++) {
    centroids.push(randomVector(dimensions, i * 1000))
  }

  // Build CENT binary format
  const dtype = useFloat16 ? 1 : 0
  const metricCode = metric === 'cosine' ? 0 : metric === 'l2' ? 1 : 2
  const bytesPerElement = useFloat16 ? 2 : 4
  const dataSize = numCentroids * dimensions * bytesPerElement
  const headerSize = 32
  const buffer = new ArrayBuffer(headerSize + dataSize)

  // Write header
  const headerView = new DataView(buffer)

  // Magic: "CENT" = 0x43454E54
  headerView.setUint8(0, 0x43) // 'C'
  headerView.setUint8(1, 0x45) // 'E'
  headerView.setUint8(2, 0x4E) // 'N'
  headerView.setUint8(3, 0x54) // 'T'

  // Version: uint16 = 1
  headerView.setUint16(4, 1, true)

  // Flags: uint16 = 0
  headerView.setUint16(6, 0, true)

  // num_centroids: uint32
  headerView.setUint32(8, numCentroids, true)

  // dimensions: uint32
  headerView.setUint32(12, dimensions, true)

  // dtype: uint8 (0 = float32, 1 = float16)
  headerView.setUint8(16, dtype)

  // metric: uint8 (0 = cosine, 1 = l2, 2 = dot)
  headerView.setUint8(17, metricCode)

  // reserved: uint8[10] (already zeroed)

  // Write centroid data
  if (useFloat16) {
    // Float16 encoding (simplified - use actual float16 in implementation)
    const dataView = new DataView(buffer, headerSize)
    let offset = 0
    for (const centroid of centroids) {
      for (let i = 0; i < dimensions; i++) {
        // Simplified float16 conversion (should use proper IEEE 754 half-precision)
        const float16 = floatToHalf(centroid[i])
        dataView.setUint16(offset, float16, true)
        offset += 2
      }
    }
  } else {
    // Float32
    const dataArray = new Float32Array(buffer, headerSize)
    let offset = 0
    for (const centroid of centroids) {
      dataArray.set(centroid, offset)
      offset += dimensions
    }
  }

  return { buffer, centroids }
}

/**
 * Simple float32 to float16 conversion (for test data generation)
 */
function floatToHalf(value: number): number {
  const floatView = new Float32Array(1)
  const int32View = new Int32Array(floatView.buffer)
  floatView[0] = value
  const x = int32View[0]

  const sign = (x >> 16) & 0x8000
  let exp = ((x >> 23) & 0xff) - 127 + 15
  const frac = x & 0x7fffff

  if (exp <= 0) {
    return sign
  } else if (exp >= 31) {
    return sign | 0x7c00
  }

  return sign | (exp << 10) | (frac >> 13)
}

// ============================================================================
// TEST CONSTANTS
// ============================================================================

const TEST_DIMENSIONS = 1536
const TEST_SMALL_DIMENSIONS = 128
const TEST_NUM_CENTROIDS = 100
const TEST_LARGE_NUM_CENTROIDS = 10000

// ============================================================================
// TESTS: LOADING FROM STATIC ASSET
// ============================================================================

describe('CentroidIndex', () => {
  describe('Loading from Static Asset (CENT format)', () => {
    it('should load centroids from binary CENT file', async () => {
      assertModuleLoaded('CentroidIndex', CentroidIndex)
      assertModuleLoaded('parseCentroidFile', parseCentroidFile)

      const { buffer, centroids: expectedCentroids } = createMockCentroidFile(
        TEST_NUM_CENTROIDS,
        TEST_SMALL_DIMENSIONS,
        'cosine'
      )

      const index = new CentroidIndex()
      await index.load(buffer)

      // Verify index is loaded
      expect(index.isLoaded()).toBe(true)
      expect(index.numCentroids).toBe(TEST_NUM_CENTROIDS)
      expect(index.dimensions).toBe(TEST_SMALL_DIMENSIONS)
      expect(index.metric).toBe('cosine')

      // Verify centroids match expected
      const loadedCentroids = index.getCentroids()
      expect(loadedCentroids).toHaveLength(TEST_NUM_CENTROIDS)

      for (let i = 0; i < TEST_NUM_CENTROIDS; i++) {
        expect(loadedCentroids[i].length).toBe(TEST_SMALL_DIMENSIONS)
        for (let d = 0; d < TEST_SMALL_DIMENSIONS; d++) {
          expect(loadedCentroids[i][d]).toBeCloseTo(expectedCentroids[i][d], 4)
        }
      }
    })

    it('should parse CENT header correctly', () => {
      assertModuleLoaded('parseCentroidFile', parseCentroidFile)

      const { buffer } = createMockCentroidFile(50, 768, 'l2')

      const parsed = parseCentroidFile(buffer)

      expect(parsed.magic).toBe('CENT')
      expect(parsed.version).toBe(1)
      expect(parsed.numCentroids).toBe(50)
      expect(parsed.dimensions).toBe(768)
      expect(parsed.dtype).toBe('float32')
      expect(parsed.metric).toBe('l2')
    })

    it('should support FP32 centroid format', async () => {
      assertModuleLoaded('CentroidIndex', CentroidIndex)

      const { buffer } = createMockCentroidFile(
        TEST_NUM_CENTROIDS,
        TEST_SMALL_DIMENSIONS,
        'cosine',
        false // FP32
      )

      const index = new CentroidIndex()
      await index.load(buffer)

      expect(index.dtype).toBe('float32')
      expect(index.numCentroids).toBe(TEST_NUM_CENTROIDS)
    })

    it('should support FP16 centroid format', async () => {
      assertModuleLoaded('CentroidIndex', CentroidIndex)

      const { buffer } = createMockCentroidFile(
        TEST_NUM_CENTROIDS,
        TEST_SMALL_DIMENSIONS,
        'cosine',
        true // FP16
      )

      const index = new CentroidIndex()
      await index.load(buffer)

      expect(index.dtype).toBe('float16')
      expect(index.numCentroids).toBe(TEST_NUM_CENTROIDS)
    })

    it('should throw error for invalid magic number', async () => {
      assertModuleLoaded('CentroidIndex', CentroidIndex)

      // Create buffer with invalid magic
      const buffer = new ArrayBuffer(64)
      const view = new DataView(buffer)
      view.setUint8(0, 0xFF) // Invalid magic
      view.setUint8(1, 0xFF)
      view.setUint8(2, 0xFF)
      view.setUint8(3, 0xFF)

      const index = new CentroidIndex()

      await expect(index.load(buffer)).rejects.toThrow(/invalid.*magic/i)
    })

    it('should throw error for unsupported version', async () => {
      assertModuleLoaded('CentroidIndex', CentroidIndex)

      // Create buffer with unsupported version
      const buffer = new ArrayBuffer(64)
      const view = new DataView(buffer)
      view.setUint8(0, 0x43) // 'C'
      view.setUint8(1, 0x45) // 'E'
      view.setUint8(2, 0x4E) // 'N'
      view.setUint8(3, 0x54) // 'T'
      view.setUint16(4, 99, true) // Unsupported version

      const index = new CentroidIndex()

      await expect(index.load(buffer)).rejects.toThrow(/unsupported.*version/i)
    })

    it('should validate buffer size matches header', async () => {
      assertModuleLoaded('CentroidIndex', CentroidIndex)

      // Create valid header but truncated data
      const { buffer } = createMockCentroidFile(100, 128, 'cosine')

      // Truncate the buffer
      const truncatedBuffer = buffer.slice(0, 100) // Way too small

      const index = new CentroidIndex()

      await expect(index.load(truncatedBuffer)).rejects.toThrow(/buffer.*size/i)
    })
  })

  // ============================================================================
  // TESTS: NEAREST CENTROID SEARCH
  // ============================================================================

  describe('Nearest Centroid Search', () => {
    let index: any
    let testCentroids: Float32Array[]

    beforeEach(async () => {
      if (!CentroidIndex) return

      const { buffer, centroids } = createMockCentroidFile(
        TEST_NUM_CENTROIDS,
        TEST_SMALL_DIMENSIONS,
        'cosine'
      )
      testCentroids = centroids

      index = new CentroidIndex()
      await index.load(buffer)
    })

    it('should search for nearest centroids given query vector', async () => {
      assertModuleLoaded('CentroidIndex', CentroidIndex)

      const query = randomVector(TEST_SMALL_DIMENSIONS, 9999)
      const k = 10

      const results = await index.search(query, k)

      expect(results).toHaveLength(k)
      expect(results[0]).toHaveProperty('clusterId')
      expect(results[0]).toHaveProperty('distance')

      // Results should be sorted by distance ascending
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i].distance).toBeLessThanOrEqual(results[i + 1].distance)
      }

      // Cluster IDs should be valid
      for (const result of results) {
        expect(result.clusterId).toBeGreaterThanOrEqual(0)
        expect(result.clusterId).toBeLessThan(TEST_NUM_CENTROIDS)
      }
    })

    it('should return top-K nearest clusters with correct distances', async () => {
      assertModuleLoaded('CentroidIndex', CentroidIndex)

      const query = randomVector(TEST_SMALL_DIMENSIONS, 12345)
      const k = 5

      // Get results from index
      const results = await index.search(query, k)

      // Get ground truth from brute force
      const groundTruth = bruteForceNearestCentroids(query, testCentroids, k, 'cosine')

      // Results should match ground truth
      expect(results).toHaveLength(groundTruth.length)

      for (let i = 0; i < k; i++) {
        expect(results[i].clusterId).toBe(groundTruth[i].clusterId)
        expect(results[i].distance).toBeCloseTo(groundTruth[i].distance, 4)
      }
    })

    it('should return fewer results if k > numCentroids', async () => {
      assertModuleLoaded('CentroidIndex', CentroidIndex)

      const query = randomVector(TEST_SMALL_DIMENSIONS, 9999)
      const k = TEST_NUM_CENTROIDS + 50 // More than available

      const results = await index.search(query, k)

      // Should return all centroids, not more
      expect(results).toHaveLength(TEST_NUM_CENTROIDS)
    })

    it('should support nprobe parameter (alias for k)', async () => {
      assertModuleLoaded('CentroidIndex', CentroidIndex)

      const query = randomVector(TEST_SMALL_DIMENSIONS, 9999)
      const nprobe = 20

      const results = await index.search(query, nprobe)

      expect(results).toHaveLength(nprobe)
    })
  })

  // ============================================================================
  // TESTS: DISTANCE METRICS
  // ============================================================================

  describe('Distance Metrics', () => {
    it('should handle cosine similarity metric', async () => {
      assertModuleLoaded('CentroidIndex', CentroidIndex)

      const { buffer, centroids } = createMockCentroidFile(
        50,
        TEST_SMALL_DIMENSIONS,
        'cosine'
      )

      const index = new CentroidIndex()
      await index.load(buffer)

      const query = randomVector(TEST_SMALL_DIMENSIONS, 9999)
      const results = await index.search(query, 5)

      // Verify cosine distance is used (1 - similarity)
      const groundTruth = bruteForceNearestCentroids(query, centroids, 5, 'cosine')

      for (let i = 0; i < 5; i++) {
        expect(results[i].clusterId).toBe(groundTruth[i].clusterId)
        // Cosine distance should be between 0 and 2
        expect(results[i].distance).toBeGreaterThanOrEqual(0)
        expect(results[i].distance).toBeLessThanOrEqual(2)
      }
    })

    it('should handle L2 distance metric', async () => {
      assertModuleLoaded('CentroidIndex', CentroidIndex)

      const { buffer, centroids } = createMockCentroidFile(
        50,
        TEST_SMALL_DIMENSIONS,
        'l2'
      )

      const index = new CentroidIndex()
      await index.load(buffer)

      expect(index.metric).toBe('l2')

      const query = randomVector(TEST_SMALL_DIMENSIONS, 9999)
      const results = await index.search(query, 5)

      // Verify L2 distance is used
      const groundTruth = bruteForceNearestCentroids(query, centroids, 5, 'l2')

      for (let i = 0; i < 5; i++) {
        expect(results[i].clusterId).toBe(groundTruth[i].clusterId)
        // L2 distance should be positive
        expect(results[i].distance).toBeGreaterThanOrEqual(0)
      }
    })

    it('should allow overriding metric at search time', async () => {
      assertModuleLoaded('CentroidIndex', CentroidIndex)

      const { buffer, centroids } = createMockCentroidFile(
        50,
        TEST_SMALL_DIMENSIONS,
        'cosine' // Default metric
      )

      const index = new CentroidIndex()
      await index.load(buffer)

      const query = randomVector(TEST_SMALL_DIMENSIONS, 9999)

      // Search with L2 instead of cosine
      const resultsL2 = await index.search(query, 5, { metric: 'l2' })
      const groundTruthL2 = bruteForceNearestCentroids(query, centroids, 5, 'l2')

      for (let i = 0; i < 5; i++) {
        expect(resultsL2[i].clusterId).toBe(groundTruthL2[i].clusterId)
      }
    })
  })

  // ============================================================================
  // TESTS: EDGE CASES
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle empty index gracefully', async () => {
      assertModuleLoaded('CentroidIndex', CentroidIndex)

      const index = new CentroidIndex()

      // Index not loaded yet
      expect(index.isLoaded()).toBe(false)
      expect(index.numCentroids).toBe(0)

      const query = randomVector(TEST_SMALL_DIMENSIONS, 9999)

      // Searching empty index should throw or return empty
      await expect(index.search(query, 10)).rejects.toThrow(/not.*loaded/i)
    })

    it('should handle query dimension mismatch', async () => {
      assertModuleLoaded('CentroidIndex', CentroidIndex)

      const { buffer } = createMockCentroidFile(
        50,
        TEST_SMALL_DIMENSIONS, // 128 dimensions
        'cosine'
      )

      const index = new CentroidIndex()
      await index.load(buffer)

      // Query with wrong dimensions
      const wrongDimQuery = randomVector(64, 9999) // 64 instead of 128

      await expect(index.search(wrongDimQuery, 10)).rejects.toThrow(/dimension.*mismatch/i)
    })

    it('should handle k=0 gracefully', async () => {
      assertModuleLoaded('CentroidIndex', CentroidIndex)

      const { buffer } = createMockCentroidFile(50, TEST_SMALL_DIMENSIONS, 'cosine')

      const index = new CentroidIndex()
      await index.load(buffer)

      const query = randomVector(TEST_SMALL_DIMENSIONS, 9999)
      const results = await index.search(query, 0)

      expect(results).toHaveLength(0)
    })

    it('should handle single centroid index', async () => {
      assertModuleLoaded('CentroidIndex', CentroidIndex)

      const { buffer } = createMockCentroidFile(1, TEST_SMALL_DIMENSIONS, 'cosine')

      const index = new CentroidIndex()
      await index.load(buffer)

      expect(index.numCentroids).toBe(1)

      const query = randomVector(TEST_SMALL_DIMENSIONS, 9999)
      const results = await index.search(query, 10)

      expect(results).toHaveLength(1)
      expect(results[0].clusterId).toBe(0)
    })

    it('should handle NaN values in query vector', async () => {
      assertModuleLoaded('CentroidIndex', CentroidIndex)

      const { buffer } = createMockCentroidFile(50, TEST_SMALL_DIMENSIONS, 'cosine')

      const index = new CentroidIndex()
      await index.load(buffer)

      // Create query with NaN
      const query = new Float32Array(TEST_SMALL_DIMENSIONS)
      query[0] = NaN
      query[1] = 0.5

      await expect(index.search(query, 10)).rejects.toThrow(/invalid.*vector|NaN/i)
    })

    it('should handle Infinity values in query vector', async () => {
      assertModuleLoaded('CentroidIndex', CentroidIndex)

      const { buffer } = createMockCentroidFile(50, TEST_SMALL_DIMENSIONS, 'cosine')

      const index = new CentroidIndex()
      await index.load(buffer)

      // Create query with Infinity
      const query = new Float32Array(TEST_SMALL_DIMENSIONS)
      query[0] = Infinity
      query[1] = 0.5

      await expect(index.search(query, 10)).rejects.toThrow(/invalid.*vector|Infinity/i)
    })
  })

  // ============================================================================
  // TESTS: PERFORMANCE
  // ============================================================================

  describe('Performance', () => {
    it('should search 10K centroids in <5ms', async () => {
      assertModuleLoaded('CentroidIndex', CentroidIndex)

      const { buffer } = createMockCentroidFile(
        TEST_LARGE_NUM_CENTROIDS, // 10K centroids
        TEST_SMALL_DIMENSIONS,    // 128 dimensions (smaller for speed)
        'cosine'
      )

      const index = new CentroidIndex()
      await index.load(buffer)

      const query = randomVector(TEST_SMALL_DIMENSIONS, 9999)
      const k = 20

      // Warm up
      await index.search(query, k)

      // Measure search time
      const iterations = 10
      const startTime = performance.now()

      for (let i = 0; i < iterations; i++) {
        await index.search(randomVector(TEST_SMALL_DIMENSIONS, i), k)
      }

      const endTime = performance.now()
      const avgTimeMs = (endTime - startTime) / iterations

      // Should complete in <5ms per search
      expect(avgTimeMs).toBeLessThan(5)
    }, { timeout: 30000 })

    it('should search 10K x 1536-dim centroids in <10ms', async () => {
      assertModuleLoaded('CentroidIndex', CentroidIndex)

      const { buffer } = createMockCentroidFile(
        TEST_LARGE_NUM_CENTROIDS, // 10K centroids
        TEST_DIMENSIONS,          // 1536 dimensions (OpenAI embedding size)
        'cosine'
      )

      const index = new CentroidIndex()
      await index.load(buffer)

      const query = randomVector(TEST_DIMENSIONS, 9999)
      const k = 20

      // Warm up
      await index.search(query, k)

      // Measure search time
      const iterations = 5
      const startTime = performance.now()

      for (let i = 0; i < iterations; i++) {
        await index.search(randomVector(TEST_DIMENSIONS, i), k)
      }

      const endTime = performance.now()
      const avgTimeMs = (endTime - startTime) / iterations

      // Should complete in <10ms per search (relaxed for full dimensions)
      expect(avgTimeMs).toBeLessThan(10)
    }, { timeout: 60000 })

    it('should load 10K centroids in <100ms', async () => {
      assertModuleLoaded('CentroidIndex', CentroidIndex)

      const { buffer } = createMockCentroidFile(
        TEST_LARGE_NUM_CENTROIDS,
        TEST_SMALL_DIMENSIONS,
        'cosine'
      )

      const startTime = performance.now()

      const index = new CentroidIndex()
      await index.load(buffer)

      const endTime = performance.now()
      const loadTimeMs = endTime - startTime

      // Should load in <100ms
      expect(loadTimeMs).toBeLessThan(100)
    }, { timeout: 30000 })
  })

  // ============================================================================
  // TESTS: MEMORY
  // ============================================================================

  describe('Memory', () => {
    it('should index 10K x 1536-dim centroids in <60MB (FP32)', async () => {
      assertModuleLoaded('CentroidIndex', CentroidIndex)

      const { buffer } = createMockCentroidFile(
        TEST_LARGE_NUM_CENTROIDS, // 10K centroids
        TEST_DIMENSIONS,          // 1536 dimensions
        'cosine',
        false                     // FP32
      )

      const index = new CentroidIndex()
      await index.load(buffer)

      const memoryStats = index.getMemoryStats()

      // Expected: 10K * 1536 * 4 bytes = 61,440,000 bytes (~58.6 MB)
      // Allow some overhead, but should be <60MB for just centroid data
      expect(memoryStats.centroidDataBytes).toBeLessThan(60 * 1024 * 1024)

      // Verify calculation
      const expectedBytes = TEST_LARGE_NUM_CENTROIDS * TEST_DIMENSIONS * 4
      expect(memoryStats.centroidDataBytes).toBe(expectedBytes)
    })

    it('should use ~30MB for 10K x 1536-dim centroids (FP16)', async () => {
      assertModuleLoaded('CentroidIndex', CentroidIndex)

      const { buffer } = createMockCentroidFile(
        TEST_LARGE_NUM_CENTROIDS, // 10K centroids
        TEST_DIMENSIONS,          // 1536 dimensions
        'cosine',
        true                      // FP16
      )

      const index = new CentroidIndex()
      await index.load(buffer)

      const memoryStats = index.getMemoryStats()

      // Expected: 10K * 1536 * 2 bytes = 30,720,000 bytes (~29.3 MB)
      expect(memoryStats.centroidDataBytes).toBeLessThan(35 * 1024 * 1024)

      // Verify calculation
      const expectedBytes = TEST_LARGE_NUM_CENTROIDS * TEST_DIMENSIONS * 2
      expect(memoryStats.centroidDataBytes).toBe(expectedBytes)
    })

    it('should report total memory usage including overhead', async () => {
      assertModuleLoaded('CentroidIndex', CentroidIndex)

      const { buffer } = createMockCentroidFile(
        TEST_NUM_CENTROIDS,
        TEST_SMALL_DIMENSIONS,
        'cosine'
      )

      const index = new CentroidIndex()
      await index.load(buffer)

      const memoryStats = index.getMemoryStats()

      expect(memoryStats).toHaveProperty('centroidDataBytes')
      expect(memoryStats).toHaveProperty('totalBytes')
      expect(memoryStats).toHaveProperty('overheadBytes')

      // Total should be >= centroid data
      expect(memoryStats.totalBytes).toBeGreaterThanOrEqual(memoryStats.centroidDataBytes)

      // Overhead should be reasonable (less than centroid data itself)
      expect(memoryStats.overheadBytes).toBeLessThan(memoryStats.centroidDataBytes)
    })
  })

  // ============================================================================
  // TESTS: SERIALIZATION
  // ============================================================================

  describe('Serialization', () => {
    it('should serialize index back to CENT format', async () => {
      assertModuleLoaded('CentroidIndex', CentroidIndex)
      assertModuleLoaded('serializeCentroidFile', serializeCentroidFile)

      const { buffer: originalBuffer, centroids: expectedCentroids } = createMockCentroidFile(
        TEST_NUM_CENTROIDS,
        TEST_SMALL_DIMENSIONS,
        'cosine'
      )

      // Load and serialize
      const index = new CentroidIndex()
      await index.load(originalBuffer)

      const serialized = serializeCentroidFile(index)

      // Load the serialized version
      const index2 = new CentroidIndex()
      await index2.load(serialized)

      // Should match original
      expect(index2.numCentroids).toBe(TEST_NUM_CENTROIDS)
      expect(index2.dimensions).toBe(TEST_SMALL_DIMENSIONS)
      expect(index2.metric).toBe('cosine')

      // Centroids should match
      const loadedCentroids = index2.getCentroids()
      for (let i = 0; i < TEST_NUM_CENTROIDS; i++) {
        for (let d = 0; d < TEST_SMALL_DIMENSIONS; d++) {
          expect(loadedCentroids[i][d]).toBeCloseTo(expectedCentroids[i][d], 4)
        }
      }
    })

    it('should produce identical search results after round-trip', async () => {
      assertModuleLoaded('CentroidIndex', CentroidIndex)
      assertModuleLoaded('serializeCentroidFile', serializeCentroidFile)

      const { buffer: originalBuffer } = createMockCentroidFile(
        TEST_NUM_CENTROIDS,
        TEST_SMALL_DIMENSIONS,
        'cosine'
      )

      // Load original
      const index1 = new CentroidIndex()
      await index1.load(originalBuffer)

      // Serialize and reload
      const serialized = serializeCentroidFile(index1)
      const index2 = new CentroidIndex()
      await index2.load(serialized)

      // Search both
      const query = randomVector(TEST_SMALL_DIMENSIONS, 9999)
      const results1 = await index1.search(query, 10)
      const results2 = await index2.search(query, 10)

      // Results should be identical
      expect(results1).toHaveLength(results2.length)
      for (let i = 0; i < results1.length; i++) {
        expect(results1[i].clusterId).toBe(results2[i].clusterId)
        expect(results1[i].distance).toBeCloseTo(results2[i].distance, 5)
      }
    })
  })

  // ============================================================================
  // TESTS: CONFIGURATION
  // ============================================================================

  describe('Configuration', () => {
    it('should support lazy loading from URL', async () => {
      assertModuleLoaded('CentroidIndex', CentroidIndex)

      const index = new CentroidIndex({
        lazyLoad: true,
      })

      // Should not be loaded yet
      expect(index.isLoaded()).toBe(false)

      // Mock fetch (in real implementation this would load from static asset URL)
      const { buffer } = createMockCentroidFile(
        TEST_NUM_CENTROIDS,
        TEST_SMALL_DIMENSIONS,
        'cosine'
      )

      // Simulate loading
      await index.load(buffer)

      expect(index.isLoaded()).toBe(true)
    })

    it('should cache centroids between queries', async () => {
      assertModuleLoaded('CentroidIndex', CentroidIndex)

      const { buffer } = createMockCentroidFile(
        TEST_NUM_CENTROIDS,
        TEST_SMALL_DIMENSIONS,
        'cosine'
      )

      const index = new CentroidIndex()
      await index.load(buffer)

      // First search
      const query1 = randomVector(TEST_SMALL_DIMENSIONS, 1)
      const results1 = await index.search(query1, 10)

      // Get reference to centroids
      const centroidsRef1 = index.getCentroids()

      // Second search
      const query2 = randomVector(TEST_SMALL_DIMENSIONS, 2)
      const results2 = await index.search(query2, 10)

      // Get reference again
      const centroidsRef2 = index.getCentroids()

      // Should be the same reference (cached, not reloaded)
      expect(centroidsRef1).toBe(centroidsRef2)
    })

    it('should support clearing cache', async () => {
      assertModuleLoaded('CentroidIndex', CentroidIndex)

      const { buffer } = createMockCentroidFile(
        TEST_NUM_CENTROIDS,
        TEST_SMALL_DIMENSIONS,
        'cosine'
      )

      const index = new CentroidIndex()
      await index.load(buffer)

      expect(index.isLoaded()).toBe(true)

      // Clear cache
      index.clear()

      expect(index.isLoaded()).toBe(false)
      expect(index.numCentroids).toBe(0)
    })

    it('should report index configuration', async () => {
      assertModuleLoaded('CentroidIndex', CentroidIndex)

      const { buffer } = createMockCentroidFile(
        TEST_NUM_CENTROIDS,
        TEST_SMALL_DIMENSIONS,
        'l2',
        true // FP16
      )

      const index = new CentroidIndex()
      await index.load(buffer)

      const config = index.getConfig()

      expect(config).toEqual({
        numCentroids: TEST_NUM_CENTROIDS,
        dimensions: TEST_SMALL_DIMENSIONS,
        metric: 'l2',
        dtype: 'float16',
        version: 1,
      })
    })
  })

  // ============================================================================
  // TESTS: STATISTICS
  // ============================================================================

  describe('Statistics', () => {
    it('should return search statistics', async () => {
      assertModuleLoaded('CentroidIndex', CentroidIndex)

      const { buffer } = createMockCentroidFile(
        TEST_NUM_CENTROIDS,
        TEST_SMALL_DIMENSIONS,
        'cosine'
      )

      const index = new CentroidIndex()
      await index.load(buffer)

      const query = randomVector(TEST_SMALL_DIMENSIONS, 9999)
      const { results, stats } = await index.searchWithStats(query, 10)

      expect(results).toHaveLength(10)
      expect(stats).toHaveProperty('centroidsScanned')
      expect(stats).toHaveProperty('searchTimeMs')
      expect(stats).toHaveProperty('distanceComputations')

      expect(stats.centroidsScanned).toBe(TEST_NUM_CENTROIDS)
      expect(stats.distanceComputations).toBe(TEST_NUM_CENTROIDS)
      expect(stats.searchTimeMs).toBeGreaterThanOrEqual(0)
    })

    it('should track cumulative search statistics', async () => {
      assertModuleLoaded('CentroidIndex', CentroidIndex)

      const { buffer } = createMockCentroidFile(
        TEST_NUM_CENTROIDS,
        TEST_SMALL_DIMENSIONS,
        'cosine'
      )

      const index = new CentroidIndex()
      await index.load(buffer)

      // Run multiple searches
      for (let i = 0; i < 5; i++) {
        await index.search(randomVector(TEST_SMALL_DIMENSIONS, i), 10)
      }

      const cumulativeStats = index.getCumulativeStats()

      expect(cumulativeStats.totalSearches).toBe(5)
      expect(cumulativeStats.totalDistanceComputations).toBe(5 * TEST_NUM_CENTROIDS)
      expect(cumulativeStats.avgSearchTimeMs).toBeGreaterThanOrEqual(0)
    })
  })
})
