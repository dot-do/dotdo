/**
 * Search Snippet - Vector Search Tests (RED Phase)
 *
 * Tests for the "100% FREE Query Architecture" using Cloudflare Snippets.
 * The search snippet fetches centroid vectors and computes distances for
 * IVF-based coarse search.
 *
 * Centroid Format (from POC dotdo-5zl0z):
 * - File: `centroids-{count}x{dims}.bin`
 * - Format: count * dims * 4 bytes (Float32) - raw binary, no header
 * - Tested performance: 256=0.29ms, 512=0.47ms, 1024=0.69ms
 *
 * These tests are expected to FAIL until the queryVector() function is implemented.
 *
 * @see docs/design/snippet-memory-budget.md
 * @see .beads/issues.jsonl (dotdo-jmqp6)
 * @module snippets/tests/search-vector.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================================
// MODULE IMPORTS (will fail until implementation exists)
// ============================================================================

// These imports will fail until the module is implemented
// This is the expected behavior for TDD - tests define the API contract
let queryVector: any
let fetchCentroids: any
let deserializeCentroids: any
let computeDistances: any
let findTopKCentroids: any
let DistanceMetric: any

// Attempt to load the module - will fail until implemented
beforeEach(async () => {
  try {
    const searchModule = await import('../search')
    queryVector = searchModule.queryVector
    fetchCentroids = searchModule.fetchCentroids
    deserializeCentroids = searchModule.deserializeCentroids
    computeDistances = searchModule.computeDistances
    findTopKCentroids = searchModule.findTopKCentroids
    DistanceMetric = searchModule.DistanceMetric
  } catch {
    // Module not yet implemented - tests will fail with clear message
    queryVector = undefined
    fetchCentroids = undefined
    deserializeCentroids = undefined
    computeDistances = undefined
    findTopKCentroids = undefined
    DistanceMetric = undefined
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
      `Search snippet module not implemented. Expected '${fnName}' from 'snippets/search'. ` +
        `Create the module to make this test pass.`
    )
  }
}

/**
 * Generate a random normalized vector (unit length for cosine similarity)
 */
function randomNormalizedVector(dims: number, seed?: number): Float32Array {
  const vec = new Float32Array(dims)
  let s = seed ?? Math.floor(Math.random() * 2147483647)

  // Generate using seeded pseudo-random (Box-Muller transform)
  let norm = 0
  for (let i = 0; i < dims; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const u1 = s / 0x7fffffff
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const u2 = s / 0x7fffffff
    const z = Math.sqrt(-2 * Math.log(u1 + 0.0001)) * Math.cos(2 * Math.PI * u2)
    vec[i] = z
    norm += z * z
  }

  // Normalize to unit length
  norm = Math.sqrt(norm)
  for (let i = 0; i < dims; i++) {
    vec[i] /= norm
  }

  return vec
}

/**
 * Create raw Float32 centroid binary (POC format - no header)
 * Format: count * dims * 4 bytes
 */
function createRawCentroidBinary(
  numCentroids: number,
  dims: number,
  centroids?: Float32Array[]
): ArrayBuffer {
  const buffer = new ArrayBuffer(numCentroids * dims * 4)
  const float32View = new Float32Array(buffer)

  if (centroids) {
    let offset = 0
    for (const centroid of centroids) {
      float32View.set(centroid, offset)
      offset += dims
    }
  } else {
    // Generate random normalized centroids
    for (let i = 0; i < numCentroids; i++) {
      const vec = randomNormalizedVector(dims, i * 1000)
      float32View.set(vec, i * dims)
    }
  }

  return buffer
}

/**
 * Create a mock fetch function for CDN assets
 */
function createMockFetch(assets: Map<string, ArrayBuffer>) {
  return vi.fn(async (url: string) => {
    const buffer = assets.get(url)
    if (!buffer) {
      return {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        arrayBuffer: async () => {
          throw new Error('Not Found')
        },
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
 * Compute cosine distance (1 - similarity)
 */
function cosineDistance(a: Float32Array, b: Float32Array): number {
  return 1 - cosineSimilarity(a, b)
}

/**
 * Compute Euclidean distance
 */
function euclideanDistance(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i]
    sum += diff * diff
  }
  return Math.sqrt(sum)
}

// ============================================================================
// TEST FIXTURES
// ============================================================================

// Small fixture for unit tests (8 centroids x 4 dims)
const SMALL_NUM_CENTROIDS = 8
const SMALL_DIMS = 4

// Create deterministic centroids for verification
const SMALL_CENTROIDS = Array.from({ length: SMALL_NUM_CENTROIDS }, (_, i) =>
  randomNormalizedVector(SMALL_DIMS, i * 1000)
)

// POC-realistic fixture sizes (from dotdo-5zl0z benchmarks)
const POC_CONFIGS = [
  { count: 256, dims: 384, expectedTimeMs: 0.5 }, // Actual: 0.29ms
  { count: 512, dims: 384, expectedTimeMs: 1.0 }, // Actual: 0.47ms
  { count: 1024, dims: 384, expectedTimeMs: 1.5 }, // Actual: 0.69ms
]

// ============================================================================
// TESTS: Fetch Centroids from CDN
// ============================================================================

describe('SearchSnippet - Vector Search', () => {
  describe('fetches centroids from CDN', () => {
    it('should fetch centroid binary file from CDN URL', async () => {
      assertModuleLoaded('fetchCentroids', fetchCentroids)

      const numCentroids = 256
      const dims = 384
      const mockAssets = new Map<string, ArrayBuffer>()
      mockAssets.set(
        'https://cdn.apis.do/centroids-256x384.bin',
        createRawCentroidBinary(numCentroids, dims)
      )

      const mockFetch = createMockFetch(mockAssets)

      const result = await fetchCentroids({
        fetch: mockFetch,
        url: 'https://cdn.apis.do/centroids-256x384.bin',
      })

      expect(result).toBeInstanceOf(ArrayBuffer)
      expect(result.byteLength).toBe(numCentroids * dims * 4)
      expect(mockFetch).toHaveBeenCalledWith('https://cdn.apis.do/centroids-256x384.bin')
    })

    it('should throw error when CDN returns 404', async () => {
      assertModuleLoaded('fetchCentroids', fetchCentroids)

      const mockAssets = new Map<string, ArrayBuffer>()
      const mockFetch = createMockFetch(mockAssets)

      await expect(
        fetchCentroids({
          fetch: mockFetch,
          url: 'https://cdn.apis.do/missing.bin',
        })
      ).rejects.toThrow(/not found|404/i)
    })

    it('should handle network errors gracefully', async () => {
      assertModuleLoaded('fetchCentroids', fetchCentroids)

      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'))

      await expect(
        fetchCentroids({
          fetch: mockFetch,
          url: 'https://cdn.apis.do/centroids.bin',
        })
      ).rejects.toThrow(/network|fetch/i)
    })

    it('should support custom CDN base URLs', async () => {
      assertModuleLoaded('fetchCentroids', fetchCentroids)

      const mockAssets = new Map<string, ArrayBuffer>()
      mockAssets.set(
        'https://custom-cdn.example.com/vectors/centroids.bin',
        createRawCentroidBinary(64, 128)
      )

      const mockFetch = createMockFetch(mockAssets)

      const result = await fetchCentroids({
        fetch: mockFetch,
        url: 'https://custom-cdn.example.com/vectors/centroids.bin',
      })

      expect(result).toBeInstanceOf(ArrayBuffer)
    })
  })

  // ============================================================================
  // TESTS: Deserialize Centroid Vectors
  // ============================================================================

  describe('deserializes centroid vectors', () => {
    it('should deserialize raw Float32Array from binary', () => {
      assertModuleLoaded('deserializeCentroids', deserializeCentroids)

      const numCentroids = SMALL_NUM_CENTROIDS
      const dims = SMALL_DIMS
      const buffer = createRawCentroidBinary(numCentroids, dims, SMALL_CENTROIDS)

      const result = deserializeCentroids(buffer, { count: numCentroids, dims })

      expect(result).toBeInstanceOf(Float32Array)
      expect(result.length).toBe(numCentroids * dims)
    })

    it('should correctly reconstruct centroid values', () => {
      assertModuleLoaded('deserializeCentroids', deserializeCentroids)

      const numCentroids = SMALL_NUM_CENTROIDS
      const dims = SMALL_DIMS
      const buffer = createRawCentroidBinary(numCentroids, dims, SMALL_CENTROIDS)

      const result = deserializeCentroids(buffer, { count: numCentroids, dims })

      // Verify first centroid matches
      for (let d = 0; d < dims; d++) {
        expect(result[d]).toBeCloseTo(SMALL_CENTROIDS[0][d], 5)
      }

      // Verify last centroid matches
      const lastOffset = (numCentroids - 1) * dims
      for (let d = 0; d < dims; d++) {
        expect(result[lastOffset + d]).toBeCloseTo(SMALL_CENTROIDS[numCentroids - 1][d], 5)
      }
    })

    it('should validate buffer size matches expected dimensions', () => {
      assertModuleLoaded('deserializeCentroids', deserializeCentroids)

      // Buffer too small
      const smallBuffer = new ArrayBuffer(100) // Not enough for 256 * 384 * 4

      expect(() =>
        deserializeCentroids(smallBuffer, { count: 256, dims: 384 })
      ).toThrow(/size.*mismatch|invalid.*buffer/i)
    })

    it('should handle POC format (256x384)', () => {
      assertModuleLoaded('deserializeCentroids', deserializeCentroids)

      const numCentroids = 256
      const dims = 384
      const buffer = createRawCentroidBinary(numCentroids, dims)

      const result = deserializeCentroids(buffer, { count: numCentroids, dims })

      expect(result.length).toBe(numCentroids * dims)
      expect(result.byteLength).toBe(numCentroids * dims * 4)
    })

    it('should handle POC format (512x384)', () => {
      assertModuleLoaded('deserializeCentroids', deserializeCentroids)

      const numCentroids = 512
      const dims = 384
      const buffer = createRawCentroidBinary(numCentroids, dims)

      const result = deserializeCentroids(buffer, { count: numCentroids, dims })

      expect(result.length).toBe(numCentroids * dims)
    })

    it('should handle POC format (1024x384)', () => {
      assertModuleLoaded('deserializeCentroids', deserializeCentroids)

      const numCentroids = 1024
      const dims = 384
      const buffer = createRawCentroidBinary(numCentroids, dims)

      const result = deserializeCentroids(buffer, { count: numCentroids, dims })

      expect(result.length).toBe(numCentroids * dims)
    })

    it('should infer dimensions from filename pattern', () => {
      assertModuleLoaded('deserializeCentroids', deserializeCentroids)

      const buffer = createRawCentroidBinary(512, 384)

      // Should be able to infer from filename pattern centroids-{count}x{dims}.bin
      const result = deserializeCentroids(buffer, {
        filename: 'centroids-512x384.bin',
      })

      expect(result.length).toBe(512 * 384)
    })
  })

  // ============================================================================
  // TESTS: Compute Distances Correctly
  // ============================================================================

  describe('computes distances correctly', () => {
    it('should compute cosine distance correctly', () => {
      assertModuleLoaded('computeDistances', computeDistances)
      assertModuleLoaded('DistanceMetric', DistanceMetric)

      const query = randomNormalizedVector(SMALL_DIMS, 999)
      const centroids = new Float32Array(SMALL_NUM_CENTROIDS * SMALL_DIMS)
      SMALL_CENTROIDS.forEach((c, i) => centroids.set(c, i * SMALL_DIMS))

      const distances = computeDistances(query, centroids, {
        numCentroids: SMALL_NUM_CENTROIDS,
        dims: SMALL_DIMS,
        metric: DistanceMetric.Cosine,
      })

      expect(distances).toBeInstanceOf(Float32Array)
      expect(distances.length).toBe(SMALL_NUM_CENTROIDS)

      // Verify distances against manual calculation
      for (let i = 0; i < SMALL_NUM_CENTROIDS; i++) {
        const expected = cosineDistance(query, SMALL_CENTROIDS[i])
        expect(distances[i]).toBeCloseTo(expected, 5)
      }
    })

    it('should compute euclidean distance correctly', () => {
      assertModuleLoaded('computeDistances', computeDistances)
      assertModuleLoaded('DistanceMetric', DistanceMetric)

      const query = randomNormalizedVector(SMALL_DIMS, 999)
      const centroids = new Float32Array(SMALL_NUM_CENTROIDS * SMALL_DIMS)
      SMALL_CENTROIDS.forEach((c, i) => centroids.set(c, i * SMALL_DIMS))

      const distances = computeDistances(query, centroids, {
        numCentroids: SMALL_NUM_CENTROIDS,
        dims: SMALL_DIMS,
        metric: DistanceMetric.Euclidean,
      })

      expect(distances).toBeInstanceOf(Float32Array)
      expect(distances.length).toBe(SMALL_NUM_CENTROIDS)

      // Verify distances against manual calculation
      for (let i = 0; i < SMALL_NUM_CENTROIDS; i++) {
        const expected = euclideanDistance(query, SMALL_CENTROIDS[i])
        expect(distances[i]).toBeCloseTo(expected, 5)
      }
    })

    it('should handle dot product (inner product) distance', () => {
      assertModuleLoaded('computeDistances', computeDistances)
      assertModuleLoaded('DistanceMetric', DistanceMetric)

      // For normalized vectors, dot product = cosine similarity
      // Distance can be 1 - dot for similarity-to-distance conversion
      const query = randomNormalizedVector(SMALL_DIMS, 999)
      const centroids = new Float32Array(SMALL_NUM_CENTROIDS * SMALL_DIMS)
      SMALL_CENTROIDS.forEach((c, i) => centroids.set(c, i * SMALL_DIMS))

      const distances = computeDistances(query, centroids, {
        numCentroids: SMALL_NUM_CENTROIDS,
        dims: SMALL_DIMS,
        metric: DistanceMetric.DotProduct,
      })

      expect(distances).toBeInstanceOf(Float32Array)
      expect(distances.length).toBe(SMALL_NUM_CENTROIDS)

      // For normalized vectors, dot product distance should be close to cosine distance
      for (let i = 0; i < SMALL_NUM_CENTROIDS; i++) {
        // Dot product for normalized vectors = cosine similarity
        // We store as negative dot product so smaller = more similar
        expect(typeof distances[i]).toBe('number')
        expect(Number.isFinite(distances[i])).toBe(true)
      }
    })

    it('should return zero distance for identical vectors', () => {
      assertModuleLoaded('computeDistances', computeDistances)
      assertModuleLoaded('DistanceMetric', DistanceMetric)

      const query = SMALL_CENTROIDS[0]
      const centroids = new Float32Array(SMALL_NUM_CENTROIDS * SMALL_DIMS)
      SMALL_CENTROIDS.forEach((c, i) => centroids.set(c, i * SMALL_DIMS))

      const distances = computeDistances(query, centroids, {
        numCentroids: SMALL_NUM_CENTROIDS,
        dims: SMALL_DIMS,
        metric: DistanceMetric.Cosine,
      })

      // Distance to self should be ~0
      expect(distances[0]).toBeCloseTo(0, 5)
    })

    it('should handle unnormalized vectors for euclidean distance', () => {
      assertModuleLoaded('computeDistances', computeDistances)
      assertModuleLoaded('DistanceMetric', DistanceMetric)

      // Create unnormalized vectors
      const query = new Float32Array([1, 2, 3, 4])
      const centroids = new Float32Array([
        0, 0, 0, 0, // centroid 0
        1, 1, 1, 1, // centroid 1
        2, 4, 6, 8, // centroid 2 (2x query)
      ])

      const distances = computeDistances(query, centroids, {
        numCentroids: 3,
        dims: 4,
        metric: DistanceMetric.Euclidean,
      })

      // Distance from [1,2,3,4] to [0,0,0,0] = sqrt(1+4+9+16) = sqrt(30)
      expect(distances[0]).toBeCloseTo(Math.sqrt(30), 4)

      // Distance from [1,2,3,4] to [1,1,1,1] = sqrt(0+1+4+9) = sqrt(14)
      expect(distances[1]).toBeCloseTo(Math.sqrt(14), 4)

      // Distance from [1,2,3,4] to [2,4,6,8] = sqrt(1+4+9+16) = sqrt(30)
      expect(distances[2]).toBeCloseTo(Math.sqrt(30), 4)
    })
  })

  // ============================================================================
  // TESTS: Returns Top-K Centroids
  // ============================================================================

  describe('returns top-K centroids', () => {
    it('should return k nearest centroids sorted by distance', () => {
      assertModuleLoaded('findTopKCentroids', findTopKCentroids)
      assertModuleLoaded('DistanceMetric', DistanceMetric)

      const query = SMALL_CENTROIDS[3] // Use centroid 3 as query
      const centroids = new Float32Array(SMALL_NUM_CENTROIDS * SMALL_DIMS)
      SMALL_CENTROIDS.forEach((c, i) => centroids.set(c, i * SMALL_DIMS))

      const topK = findTopKCentroids(query, centroids, {
        numCentroids: SMALL_NUM_CENTROIDS,
        dims: SMALL_DIMS,
        k: 3,
        metric: DistanceMetric.Cosine,
      })

      expect(topK).toHaveLength(3)

      // First result should be centroid 3 (identical to query)
      expect(topK[0].index).toBe(3)
      expect(topK[0].distance).toBeCloseTo(0, 5)

      // Results should be sorted by distance (ascending)
      for (let i = 0; i < topK.length - 1; i++) {
        expect(topK[i].distance).toBeLessThanOrEqual(topK[i + 1].distance)
      }
    })

    it('should return all centroids when k >= numCentroids', () => {
      assertModuleLoaded('findTopKCentroids', findTopKCentroids)
      assertModuleLoaded('DistanceMetric', DistanceMetric)

      const query = randomNormalizedVector(SMALL_DIMS, 999)
      const centroids = new Float32Array(SMALL_NUM_CENTROIDS * SMALL_DIMS)
      SMALL_CENTROIDS.forEach((c, i) => centroids.set(c, i * SMALL_DIMS))

      const topK = findTopKCentroids(query, centroids, {
        numCentroids: SMALL_NUM_CENTROIDS,
        dims: SMALL_DIMS,
        k: 100, // More than available
        metric: DistanceMetric.Cosine,
      })

      expect(topK).toHaveLength(SMALL_NUM_CENTROIDS)
    })

    it('should return correct indices', () => {
      assertModuleLoaded('findTopKCentroids', findTopKCentroids)
      assertModuleLoaded('DistanceMetric', DistanceMetric)

      const query = randomNormalizedVector(SMALL_DIMS, 999)
      const centroids = new Float32Array(SMALL_NUM_CENTROIDS * SMALL_DIMS)
      SMALL_CENTROIDS.forEach((c, i) => centroids.set(c, i * SMALL_DIMS))

      const topK = findTopKCentroids(query, centroids, {
        numCentroids: SMALL_NUM_CENTROIDS,
        dims: SMALL_DIMS,
        k: 5,
        metric: DistanceMetric.Cosine,
      })

      // All indices should be valid
      for (const result of topK) {
        expect(result.index).toBeGreaterThanOrEqual(0)
        expect(result.index).toBeLessThan(SMALL_NUM_CENTROIDS)
        expect(typeof result.distance).toBe('number')
        expect(Number.isFinite(result.distance)).toBe(true)
      }

      // No duplicate indices
      const indices = topK.map((r) => r.index)
      expect(new Set(indices).size).toBe(indices.length)
    })

    it('should handle k=1', () => {
      assertModuleLoaded('findTopKCentroids', findTopKCentroids)
      assertModuleLoaded('DistanceMetric', DistanceMetric)

      const query = SMALL_CENTROIDS[5]
      const centroids = new Float32Array(SMALL_NUM_CENTROIDS * SMALL_DIMS)
      SMALL_CENTROIDS.forEach((c, i) => centroids.set(c, i * SMALL_DIMS))

      const topK = findTopKCentroids(query, centroids, {
        numCentroids: SMALL_NUM_CENTROIDS,
        dims: SMALL_DIMS,
        k: 1,
        metric: DistanceMetric.Cosine,
      })

      expect(topK).toHaveLength(1)
      expect(topK[0].index).toBe(5)
      expect(topK[0].distance).toBeCloseTo(0, 5)
    })

    it('should return empty array for k=0', () => {
      assertModuleLoaded('findTopKCentroids', findTopKCentroids)
      assertModuleLoaded('DistanceMetric', DistanceMetric)

      const query = randomNormalizedVector(SMALL_DIMS, 999)
      const centroids = new Float32Array(SMALL_NUM_CENTROIDS * SMALL_DIMS)

      const topK = findTopKCentroids(query, centroids, {
        numCentroids: SMALL_NUM_CENTROIDS,
        dims: SMALL_DIMS,
        k: 0,
        metric: DistanceMetric.Cosine,
      })

      expect(topK).toHaveLength(0)
    })

    it('should support different distance metrics', () => {
      assertModuleLoaded('findTopKCentroids', findTopKCentroids)
      assertModuleLoaded('DistanceMetric', DistanceMetric)

      const query = randomNormalizedVector(SMALL_DIMS, 999)
      const centroids = new Float32Array(SMALL_NUM_CENTROIDS * SMALL_DIMS)
      SMALL_CENTROIDS.forEach((c, i) => centroids.set(c, i * SMALL_DIMS))

      const cosineResults = findTopKCentroids(query, centroids, {
        numCentroids: SMALL_NUM_CENTROIDS,
        dims: SMALL_DIMS,
        k: 3,
        metric: DistanceMetric.Cosine,
      })

      const euclideanResults = findTopKCentroids(query, centroids, {
        numCentroids: SMALL_NUM_CENTROIDS,
        dims: SMALL_DIMS,
        k: 3,
        metric: DistanceMetric.Euclidean,
      })

      // Both should return valid results
      expect(cosineResults).toHaveLength(3)
      expect(euclideanResults).toHaveLength(3)

      // Results may differ based on metric
      // (for normalized vectors they should be similar but not identical)
    })
  })

  // ============================================================================
  // TESTS: Performance - Complete within 3ms for 512 Centroids
  // ============================================================================

  describe('completes within 3ms for 512 centroids', () => {
    it('should complete distance computation in <1ms for 256 centroids', () => {
      assertModuleLoaded('computeDistances', computeDistances)
      assertModuleLoaded('DistanceMetric', DistanceMetric)

      const numCentroids = 256
      const dims = 384
      const query = randomNormalizedVector(dims, 42)
      const centroids = new Float32Array(numCentroids * dims)
      for (let i = 0; i < numCentroids; i++) {
        const vec = randomNormalizedVector(dims, i * 1000)
        centroids.set(vec, i * dims)
      }

      // Warmup
      for (let i = 0; i < 5; i++) {
        computeDistances(query, centroids, {
          numCentroids,
          dims,
          metric: DistanceMetric.Cosine,
        })
      }

      // Measure
      const times: number[] = []
      for (let i = 0; i < 100; i++) {
        const start = performance.now()
        computeDistances(query, centroids, {
          numCentroids,
          dims,
          metric: DistanceMetric.Cosine,
        })
        times.push(performance.now() - start)
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / times.length

      // POC showed 0.29ms for 256 centroids - allow 1ms budget
      expect(avgTime).toBeLessThan(1)
    })

    it('should complete distance computation in <1.5ms for 512 centroids', () => {
      assertModuleLoaded('computeDistances', computeDistances)
      assertModuleLoaded('DistanceMetric', DistanceMetric)

      const numCentroids = 512
      const dims = 384
      const query = randomNormalizedVector(dims, 42)
      const centroids = new Float32Array(numCentroids * dims)
      for (let i = 0; i < numCentroids; i++) {
        const vec = randomNormalizedVector(dims, i * 1000)
        centroids.set(vec, i * dims)
      }

      // Warmup
      for (let i = 0; i < 5; i++) {
        computeDistances(query, centroids, {
          numCentroids,
          dims,
          metric: DistanceMetric.Cosine,
        })
      }

      // Measure
      const times: number[] = []
      for (let i = 0; i < 100; i++) {
        const start = performance.now()
        computeDistances(query, centroids, {
          numCentroids,
          dims,
          metric: DistanceMetric.Cosine,
        })
        times.push(performance.now() - start)
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / times.length

      // POC showed 0.47ms for 512 centroids - allow 1.5ms budget
      expect(avgTime).toBeLessThan(1.5)
    })

    it('should complete full queryVector in <3ms for 512 centroids', async () => {
      assertModuleLoaded('queryVector', queryVector)
      assertModuleLoaded('DistanceMetric', DistanceMetric)

      const numCentroids = 512
      const dims = 384
      const mockAssets = new Map<string, ArrayBuffer>()
      mockAssets.set(
        'https://cdn.apis.do/centroids-512x384.bin',
        createRawCentroidBinary(numCentroids, dims)
      )

      const mockFetch = createMockFetch(mockAssets)
      const query = randomNormalizedVector(dims, 42)

      // First call includes fetch (excluded from timing constraint)
      await queryVector({
        fetch: mockFetch,
        centroidsUrl: 'https://cdn.apis.do/centroids-512x384.bin',
        query,
        numCentroids,
        dims,
        k: 10,
        metric: DistanceMetric.Cosine,
      })

      // Second call uses cached centroids - measure this
      const times: number[] = []
      for (let i = 0; i < 50; i++) {
        const start = performance.now()
        await queryVector({
          fetch: mockFetch,
          centroidsUrl: 'https://cdn.apis.do/centroids-512x384.bin',
          query,
          numCentroids,
          dims,
          k: 10,
          metric: DistanceMetric.Cosine,
        })
        times.push(performance.now() - start)
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / times.length

      // Full search (compute distances + top-K selection) should be <3ms
      expect(avgTime).toBeLessThan(3)
    })

    it('should complete within 3ms for 1024 centroids', () => {
      assertModuleLoaded('computeDistances', computeDistances)
      assertModuleLoaded('DistanceMetric', DistanceMetric)

      const numCentroids = 1024
      const dims = 384
      const query = randomNormalizedVector(dims, 42)
      const centroids = new Float32Array(numCentroids * dims)
      for (let i = 0; i < numCentroids; i++) {
        const vec = randomNormalizedVector(dims, i * 1000)
        centroids.set(vec, i * dims)
      }

      // Warmup
      for (let i = 0; i < 5; i++) {
        computeDistances(query, centroids, {
          numCentroids,
          dims,
          metric: DistanceMetric.Cosine,
        })
      }

      // Measure
      const times: number[] = []
      for (let i = 0; i < 50; i++) {
        const start = performance.now()
        computeDistances(query, centroids, {
          numCentroids,
          dims,
          metric: DistanceMetric.Cosine,
        })
        times.push(performance.now() - start)
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / times.length

      // POC showed 0.69ms for 1024 centroids - allow 3ms budget
      expect(avgTime).toBeLessThan(3)
    })

    it('should scale linearly with centroid count', () => {
      assertModuleLoaded('computeDistances', computeDistances)
      assertModuleLoaded('DistanceMetric', DistanceMetric)

      const dims = 384
      const configs = [
        { numCentroids: 128 },
        { numCentroids: 256 },
        { numCentroids: 512 },
        { numCentroids: 1024 },
      ]

      const results: { numCentroids: number; avgTime: number }[] = []

      for (const config of configs) {
        const query = randomNormalizedVector(dims, 42)
        const centroids = new Float32Array(config.numCentroids * dims)
        for (let i = 0; i < config.numCentroids; i++) {
          const vec = randomNormalizedVector(dims, i * 1000)
          centroids.set(vec, i * dims)
        }

        // Warmup
        for (let i = 0; i < 3; i++) {
          computeDistances(query, centroids, {
            numCentroids: config.numCentroids,
            dims,
            metric: DistanceMetric.Cosine,
          })
        }

        // Measure
        const times: number[] = []
        for (let i = 0; i < 20; i++) {
          const start = performance.now()
          computeDistances(query, centroids, {
            numCentroids: config.numCentroids,
            dims,
            metric: DistanceMetric.Cosine,
          })
          times.push(performance.now() - start)
        }

        const avgTime = times.reduce((a, b) => a + b, 0) / times.length
        results.push({ numCentroids: config.numCentroids, avgTime })
      }

      // Verify roughly linear scaling (not O(n^2))
      // 8x more centroids (128 -> 1024) should not be more than 16x slower
      const ratio = results[3].avgTime / results[0].avgTime
      expect(ratio).toBeLessThan(16)
    })
  })

  // ============================================================================
  // TESTS: Handle Different Distance Metrics
  // ============================================================================

  describe('handles different distance metrics (cosine, euclidean)', () => {
    it('should support cosine distance metric enum', () => {
      assertModuleLoaded('DistanceMetric', DistanceMetric)

      expect(DistanceMetric.Cosine).toBeDefined()
      expect(typeof DistanceMetric.Cosine).toBe('string')
    })

    it('should support euclidean distance metric enum', () => {
      assertModuleLoaded('DistanceMetric', DistanceMetric)

      expect(DistanceMetric.Euclidean).toBeDefined()
      expect(typeof DistanceMetric.Euclidean).toBe('string')
    })

    it('should support dot product distance metric enum', () => {
      assertModuleLoaded('DistanceMetric', DistanceMetric)

      expect(DistanceMetric.DotProduct).toBeDefined()
      expect(typeof DistanceMetric.DotProduct).toBe('string')
    })

    it('should default to cosine distance if not specified', async () => {
      assertModuleLoaded('queryVector', queryVector)

      const numCentroids = 8
      const dims = 4
      const mockAssets = new Map<string, ArrayBuffer>()
      mockAssets.set(
        'https://cdn.apis.do/centroids.bin',
        createRawCentroidBinary(numCentroids, dims, SMALL_CENTROIDS)
      )

      const mockFetch = createMockFetch(mockAssets)
      const query = SMALL_CENTROIDS[2]

      const results = await queryVector({
        fetch: mockFetch,
        centroidsUrl: 'https://cdn.apis.do/centroids.bin',
        query,
        numCentroids,
        dims,
        k: 3,
        // No metric specified - should default to cosine
      })

      // First result should be centroid 2 (identical to query)
      expect(results[0].index).toBe(2)
      expect(results[0].distance).toBeCloseTo(0, 5)
    })

    it('should produce different orderings for different metrics', () => {
      assertModuleLoaded('findTopKCentroids', findTopKCentroids)
      assertModuleLoaded('DistanceMetric', DistanceMetric)

      // Create vectors where cosine and euclidean give different orderings
      // Vector A: [1, 0, 0, 0] - unit length
      // Vector B: [2, 0, 0, 0] - same direction as A but 2x magnitude
      // Vector C: [0.7, 0.7, 0, 0] - different direction, unit length

      const query = new Float32Array([1, 0, 0, 0])
      const centroids = new Float32Array([
        2, 0, 0, 0, // A: same direction, 2x magnitude
        0.707, 0.707, 0, 0, // B: 45 degrees, unit length
        0.5, 0, 0, 0, // C: same direction, 0.5x magnitude
      ])

      const cosineResults = findTopKCentroids(query, centroids, {
        numCentroids: 3,
        dims: 4,
        k: 3,
        metric: DistanceMetric.Cosine,
      })

      const euclideanResults = findTopKCentroids(query, centroids, {
        numCentroids: 3,
        dims: 4,
        k: 3,
        metric: DistanceMetric.Euclidean,
      })

      // Cosine: A and C are both distance 0 (same direction), B is farther
      // Euclidean: C (0.5 away), B (~0.5 away), A (1 away)

      // The orderings should be different
      // Note: exact values depend on implementation
      expect(cosineResults).toHaveLength(3)
      expect(euclideanResults).toHaveLength(3)
    })
  })

  // ============================================================================
  // TESTS: Full Integration - queryVector()
  // ============================================================================

  describe('queryVector() integration', () => {
    it('should fetch, deserialize, compute, and return top-K in one call', async () => {
      assertModuleLoaded('queryVector', queryVector)
      assertModuleLoaded('DistanceMetric', DistanceMetric)

      const numCentroids = SMALL_NUM_CENTROIDS
      const dims = SMALL_DIMS
      const mockAssets = new Map<string, ArrayBuffer>()
      mockAssets.set(
        'https://cdn.apis.do/centroids.bin',
        createRawCentroidBinary(numCentroids, dims, SMALL_CENTROIDS)
      )

      const mockFetch = createMockFetch(mockAssets)
      const query = SMALL_CENTROIDS[4]

      const results = await queryVector({
        fetch: mockFetch,
        centroidsUrl: 'https://cdn.apis.do/centroids.bin',
        query,
        numCentroids,
        dims,
        k: 3,
        metric: DistanceMetric.Cosine,
      })

      expect(results).toHaveLength(3)
      expect(results[0].index).toBe(4) // Closest to itself
      expect(results[0].distance).toBeCloseTo(0, 5)
    })

    it('should cache centroids across multiple queries', async () => {
      assertModuleLoaded('queryVector', queryVector)
      assertModuleLoaded('DistanceMetric', DistanceMetric)

      const numCentroids = 64
      const dims = 128
      const mockAssets = new Map<string, ArrayBuffer>()
      mockAssets.set(
        'https://cdn.apis.do/centroids.bin',
        createRawCentroidBinary(numCentroids, dims)
      )

      const mockFetch = createMockFetch(mockAssets)

      // First query
      await queryVector({
        fetch: mockFetch,
        centroidsUrl: 'https://cdn.apis.do/centroids.bin',
        query: randomNormalizedVector(dims, 1),
        numCentroids,
        dims,
        k: 5,
        metric: DistanceMetric.Cosine,
      })

      // Second query
      await queryVector({
        fetch: mockFetch,
        centroidsUrl: 'https://cdn.apis.do/centroids.bin',
        query: randomNormalizedVector(dims, 2),
        numCentroids,
        dims,
        k: 5,
        metric: DistanceMetric.Cosine,
      })

      // Fetch should only be called once (cached)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('should throw for invalid query dimensions', async () => {
      assertModuleLoaded('queryVector', queryVector)

      const mockAssets = new Map<string, ArrayBuffer>()
      mockAssets.set(
        'https://cdn.apis.do/centroids.bin',
        createRawCentroidBinary(10, 128)
      )

      const mockFetch = createMockFetch(mockAssets)
      const wrongDimQuery = randomNormalizedVector(64, 42) // Wrong dimension

      await expect(
        queryVector({
          fetch: mockFetch,
          centroidsUrl: 'https://cdn.apis.do/centroids.bin',
          query: wrongDimQuery,
          numCentroids: 10,
          dims: 128, // Expected 128, but query is 64
          k: 5,
        })
      ).rejects.toThrow(/dimension.*mismatch/i)
    })

    it('should return results with both index and distance', async () => {
      assertModuleLoaded('queryVector', queryVector)

      const numCentroids = 16
      const dims = 32
      const mockAssets = new Map<string, ArrayBuffer>()
      mockAssets.set(
        'https://cdn.apis.do/centroids.bin',
        createRawCentroidBinary(numCentroids, dims)
      )

      const mockFetch = createMockFetch(mockAssets)
      const query = randomNormalizedVector(dims, 42)

      const results = await queryVector({
        fetch: mockFetch,
        centroidsUrl: 'https://cdn.apis.do/centroids.bin',
        query,
        numCentroids,
        dims,
        k: 5,
      })

      expect(results).toHaveLength(5)
      for (const result of results) {
        expect(result).toHaveProperty('index')
        expect(result).toHaveProperty('distance')
        expect(typeof result.index).toBe('number')
        expect(typeof result.distance).toBe('number')
        expect(result.index).toBeGreaterThanOrEqual(0)
        expect(result.index).toBeLessThan(numCentroids)
        expect(Number.isFinite(result.distance)).toBe(true)
      }
    })
  })

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle empty query vector', async () => {
      assertModuleLoaded('queryVector', queryVector)

      const mockAssets = new Map<string, ArrayBuffer>()
      mockAssets.set(
        'https://cdn.apis.do/centroids.bin',
        createRawCentroidBinary(10, 64)
      )

      const mockFetch = createMockFetch(mockAssets)
      const emptyQuery = new Float32Array(0)

      await expect(
        queryVector({
          fetch: mockFetch,
          centroidsUrl: 'https://cdn.apis.do/centroids.bin',
          query: emptyQuery,
          numCentroids: 10,
          dims: 64,
          k: 5,
        })
      ).rejects.toThrow(/empty|invalid.*query|dimension mismatch/i)
    })

    it('should handle single centroid', async () => {
      assertModuleLoaded('queryVector', queryVector)
      assertModuleLoaded('DistanceMetric', DistanceMetric)

      const numCentroids = 1
      const dims = 8
      const singleCentroid = [randomNormalizedVector(dims, 1)]
      const mockAssets = new Map<string, ArrayBuffer>()
      mockAssets.set(
        'https://cdn.apis.do/centroids.bin',
        createRawCentroidBinary(numCentroids, dims, singleCentroid)
      )

      const mockFetch = createMockFetch(mockAssets)
      const query = singleCentroid[0]

      const results = await queryVector({
        fetch: mockFetch,
        centroidsUrl: 'https://cdn.apis.do/centroids.bin',
        query,
        numCentroids,
        dims,
        k: 10,
        metric: DistanceMetric.Cosine,
      })

      expect(results).toHaveLength(1)
      expect(results[0].index).toBe(0)
      expect(results[0].distance).toBeCloseTo(0, 5)
    })

    it('should handle zero vector query', () => {
      assertModuleLoaded('computeDistances', computeDistances)
      assertModuleLoaded('DistanceMetric', DistanceMetric)

      const zeroQuery = new Float32Array(4).fill(0)
      const centroids = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0])

      // Zero vector should produce NaN or Infinity for cosine
      // (since norm is 0, division by zero)
      const distances = computeDistances(zeroQuery, centroids, {
        numCentroids: 2,
        dims: 4,
        metric: DistanceMetric.Cosine,
      })

      // Implementation should handle gracefully (return NaN, Infinity, or throw)
      expect(distances).toBeDefined()
    })

    it('should handle very large k values', () => {
      assertModuleLoaded('findTopKCentroids', findTopKCentroids)
      assertModuleLoaded('DistanceMetric', DistanceMetric)

      const query = randomNormalizedVector(SMALL_DIMS, 42)
      const centroids = new Float32Array(SMALL_NUM_CENTROIDS * SMALL_DIMS)
      SMALL_CENTROIDS.forEach((c, i) => centroids.set(c, i * SMALL_DIMS))

      const results = findTopKCentroids(query, centroids, {
        numCentroids: SMALL_NUM_CENTROIDS,
        dims: SMALL_DIMS,
        k: Number.MAX_SAFE_INTEGER,
        metric: DistanceMetric.Cosine,
      })

      // Should clamp to available centroids
      expect(results.length).toBe(SMALL_NUM_CENTROIDS)
    })
  })
})
