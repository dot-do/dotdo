/**
 * IVF Index Tests - Inverted File Index with Centroids
 *
 * RED phase TDD tests for Inverted File (IVF) index implementation.
 * IVF is an approximate nearest neighbor (ANN) algorithm that:
 * 1. Partitions vectors into clusters using k-means clustering
 * 2. Stores inverted lists mapping centroid -> vector IDs
 * 3. At search time, probes only the nprobe nearest clusters
 *
 * Benefits:
 * - Sublinear search time: O(nprobe * cluster_size) vs O(n) for brute force
 * - Memory efficient: stores cluster assignments, not full vector copies
 * - Tunable accuracy/speed tradeoff via nprobe parameter
 *
 * Tests should FAIL until IVFIndex is implemented.
 *
 * @see types/vector.ts - Centroid, IVFPQConfig types
 * @see docs/research/vector-index-ann-perspective.md
 * @module tests/vector/ivf-index.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Import types and implementation that will be created
import type {
  Centroid,
  DistanceMetric,
  SearchResult,
} from '../../types/vector'

// The IVFIndex class that will be implemented
import { IVFIndex } from '../../db/vector/ivf'
import type {
  IVFConfig,
  IVFStats,
  IVFTrainingOptions,
  InvertedList,
  ClusterAssignment,
} from '../../db/vector/ivf'

// ============================================================================
// TEST UTILITIES
// ============================================================================

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
  for (let i = 0; i < v.length; i++) {
    result[i] = v[i] / norm
  }
  return result
}

/**
 * Create a random vector
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
 * Create test vectors with optional clustering
 * Generates vectors that cluster around specified cluster centers
 */
function createClusteredVectors(
  numVectors: number,
  dimensions: number,
  numClusters: number,
  spread: number = 0.1
): { vectors: Float32Array[]; ids: string[]; trueLabels: number[] } {
  const vectors: Float32Array[] = []
  const ids: string[] = []
  const trueLabels: number[] = []

  // Create cluster centers
  const centers = Array.from({ length: numClusters }, (_, i) =>
    randomVector(dimensions, i * 1000)
  )

  for (let i = 0; i < numVectors; i++) {
    const clusterId = i % numClusters
    const center = centers[clusterId]

    // Add noise to center
    const vec = new Float32Array(dimensions)
    for (let d = 0; d < dimensions; d++) {
      vec[d] = center[d] + (Math.random() - 0.5) * spread
    }

    vectors.push(normalizeVector(vec))
    ids.push(`vec-${i}`)
    trueLabels.push(clusterId)
  }

  return { vectors, ids, trueLabels }
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
 * Brute force k-nearest neighbors for ground truth comparison
 */
function bruteForceKNN(
  query: Float32Array,
  vectors: Float32Array[],
  ids: string[],
  k: number,
  metric: DistanceMetric = 'cosine'
): SearchResult[] {
  const scores = vectors.map((vec, i) => ({
    id: ids[i],
    score: metric === 'cosine' ? cosineSimilarity(query, vec) : l2Distance(query, vec),
  }))

  // Sort: descending for cosine (higher is better), ascending for L2 (lower is better)
  scores.sort((a, b) =>
    metric === 'cosine' ? b.score - a.score : a.score - b.score
  )

  return scores.slice(0, k)
}

/**
 * Calculate recall@k for approximate search results
 */
function calculateRecall(
  approximate: SearchResult[],
  groundTruth: SearchResult[]
): number {
  const truthIds = new Set(groundTruth.map(r => r.id))
  const hits = approximate.filter(r => truthIds.has(r.id)).length
  return hits / groundTruth.length
}

// ============================================================================
// TEST CONSTANTS
// ============================================================================

const TEST_DIMENSIONS = 128
const TEST_NLIST = 16 // Number of clusters
const TEST_NPROBE = 4 // Number of clusters to probe

// ============================================================================
// TESTS: TRAINING AND CENTROID COMPUTATION
// ============================================================================

describe('IVFIndex', () => {
  describe('Training - k-means clustering', () => {
    it('should train centroids using k-means clustering', async () => {
      const index = new IVFIndex({
        dimensions: TEST_DIMENSIONS,
        nlist: 8,
        metric: 'cosine',
      })

      // Create training data with 8 natural clusters
      const { vectors, ids } = createClusteredVectors(1000, TEST_DIMENSIONS, 8)

      // Add vectors to index
      for (let i = 0; i < vectors.length; i++) {
        await index.add(ids[i], vectors[i])
      }

      // Train the index
      await index.train()

      // Verify centroids were computed
      const centroids = index.getCentroids()
      expect(centroids).toHaveLength(8)

      // Each centroid should be a valid vector
      centroids.forEach((centroid) => {
        expect(centroid.vector).toBeInstanceOf(Float32Array)
        expect(centroid.vector.length).toBe(TEST_DIMENSIONS)
        // Centroid should be normalized (for cosine metric)
        const norm = Math.sqrt(
          centroid.vector.reduce((sum, v) => sum + v * v, 0)
        )
        expect(norm).toBeCloseTo(1.0, 2)
      })
    })

    it('should converge k-means within max iterations', async () => {
      const index = new IVFIndex({
        dimensions: TEST_DIMENSIONS,
        nlist: TEST_NLIST,
        metric: 'cosine',
      })

      const { vectors, ids } = createClusteredVectors(500, TEST_DIMENSIONS, TEST_NLIST)

      for (let i = 0; i < vectors.length; i++) {
        await index.add(ids[i], vectors[i])
      }

      const maxIterations = 50
      const result = await index.train({ maxIterations, convergenceThreshold: 0.0001 })

      expect(result.converged).toBe(true)
      expect(result.iterations).toBeLessThanOrEqual(maxIterations)
      expect(result.finalError).toBeLessThan(result.initialError)
    })

    it('should use k-means++ initialization for better convergence', async () => {
      const index = new IVFIndex({
        dimensions: TEST_DIMENSIONS,
        nlist: TEST_NLIST,
        metric: 'cosine',
      })

      const { vectors, ids } = createClusteredVectors(1000, TEST_DIMENSIONS, TEST_NLIST)

      for (let i = 0; i < vectors.length; i++) {
        await index.add(ids[i], vectors[i])
      }

      // Train with k-means++ initialization
      const resultKMeansPP = await index.train({ initialization: 'kmeans++' })

      // Create new index with random initialization for comparison
      const indexRandom = new IVFIndex({
        dimensions: TEST_DIMENSIONS,
        nlist: TEST_NLIST,
        metric: 'cosine',
      })

      for (let i = 0; i < vectors.length; i++) {
        await indexRandom.add(ids[i], vectors[i])
      }

      const resultRandom = await indexRandom.train({ initialization: 'random' })

      // k-means++ should converge faster or to better solution
      expect(resultKMeansPP.finalError).toBeLessThanOrEqual(resultRandom.finalError * 1.5)
    })

    it('should throw error when training with insufficient vectors', async () => {
      const index = new IVFIndex({
        dimensions: TEST_DIMENSIONS,
        nlist: 100, // More clusters than vectors
        metric: 'cosine',
      })

      // Add only 10 vectors
      for (let i = 0; i < 10; i++) {
        await index.add(`vec-${i}`, randomVector(TEST_DIMENSIONS, i))
      }

      // Should throw because nlist > num_vectors
      await expect(index.train()).rejects.toThrow(/insufficient.*vectors/i)
    })

    it('should require minimum vectors per cluster for training', async () => {
      const index = new IVFIndex({
        dimensions: TEST_DIMENSIONS,
        nlist: 50,
        metric: 'cosine',
      })

      // Add 100 vectors for 50 clusters (only 2 per cluster on average)
      for (let i = 0; i < 100; i++) {
        await index.add(`vec-${i}`, randomVector(TEST_DIMENSIONS, i))
      }

      // Should warn about low vectors per cluster but proceed
      const result = await index.train()
      expect(result.warnings).toContain(expect.stringMatching(/low.*vectors.*cluster/i))
    })
  })

  // ============================================================================
  // TESTS: VECTOR ASSIGNMENT TO CLUSTERS
  // ============================================================================

  describe('Vector Assignment', () => {
    let index: InstanceType<typeof IVFIndex>

    beforeEach(async () => {
      index = new IVFIndex({
        dimensions: TEST_DIMENSIONS,
        nlist: TEST_NLIST,
        metric: 'cosine',
      })

      const { vectors, ids } = createClusteredVectors(500, TEST_DIMENSIONS, TEST_NLIST)
      for (let i = 0; i < vectors.length; i++) {
        await index.add(ids[i], vectors[i])
      }
      await index.train()
    })

    it('should assign vectors to nearest centroid (cluster)', async () => {
      // Get a specific vector and its assignment
      const vectorId = 'vec-0'
      const assignment = await index.getVectorAssignment(vectorId)

      expect(assignment).toBeDefined()
      expect(assignment!.centroidId).toBeGreaterThanOrEqual(0)
      expect(assignment!.centroidId).toBeLessThan(TEST_NLIST)
      expect(assignment!.distance).toBeGreaterThanOrEqual(0)

      // Verify it's assigned to the NEAREST centroid
      const vector = await index.getVector(vectorId)
      const centroids = index.getCentroids()

      // Find actual nearest centroid
      let minDist = Infinity
      let nearestId = -1
      for (const centroid of centroids) {
        const dist = 1 - cosineSimilarity(vector!, centroid.vector)
        if (dist < minDist) {
          minDist = dist
          nearestId = centroid.id
        }
      }

      expect(assignment!.centroidId).toBe(nearestId)
    })

    it('should store inverted lists mapping centroid -> vector IDs', async () => {
      const invertedLists = index.getInvertedLists()

      expect(invertedLists).toBeDefined()
      expect(Object.keys(invertedLists)).toHaveLength(TEST_NLIST)

      // Each centroid should have an inverted list
      for (let i = 0; i < TEST_NLIST; i++) {
        expect(invertedLists[i]).toBeDefined()
        expect(Array.isArray(invertedLists[i].vectorIds)).toBe(true)
      }

      // Total vectors across all lists should equal total indexed vectors
      let totalVectors = 0
      for (const list of Object.values(invertedLists)) {
        totalVectors += list.vectorIds.length
      }
      expect(totalVectors).toBe(500)
    })

    it('should update inverted list when vector is deleted', async () => {
      const vectorId = 'vec-0'
      const assignment = await index.getVectorAssignment(vectorId)
      const centroidId = assignment!.centroidId

      // Get list before deletion
      const listBefore = index.getInvertedLists()[centroidId]
      expect(listBefore.vectorIds).toContain(vectorId)

      // Delete the vector
      await index.delete(vectorId)

      // Verify removed from inverted list
      const listAfter = index.getInvertedLists()[centroidId]
      expect(listAfter.vectorIds).not.toContain(vectorId)
    })

    it('should reassign vectors after centroid updates', async () => {
      // Get current assignments
      const assignmentsBefore = new Map<string, number>()
      for (let i = 0; i < 500; i++) {
        const id = `vec-${i}`
        const assignment = await index.getVectorAssignment(id)
        assignmentsBefore.set(id, assignment!.centroidId)
      }

      // Retrain with different random seed (should produce different centroids)
      await index.train({ randomSeed: 42 })

      // Some vectors should be in different clusters now
      let reassignedCount = 0
      for (let i = 0; i < 500; i++) {
        const id = `vec-${i}`
        const newAssignment = await index.getVectorAssignment(id)
        if (newAssignment!.centroidId !== assignmentsBefore.get(id)) {
          reassignedCount++
        }
      }

      // At least some vectors should have moved
      expect(reassignedCount).toBeGreaterThan(0)
    })
  })

  // ============================================================================
  // TESTS: SEARCH WITH CLUSTER PROBING
  // ============================================================================

  describe('Search', () => {
    let index: InstanceType<typeof IVFIndex>
    let testVectors: Float32Array[]
    let testIds: string[]

    beforeEach(async () => {
      index = new IVFIndex({
        dimensions: TEST_DIMENSIONS,
        nlist: TEST_NLIST,
        nprobe: TEST_NPROBE,
        metric: 'cosine',
      })

      const data = createClusteredVectors(1000, TEST_DIMENSIONS, TEST_NLIST)
      testVectors = data.vectors
      testIds = data.ids

      for (let i = 0; i < testVectors.length; i++) {
        await index.add(testIds[i], testVectors[i])
      }
      await index.train()
    })

    it('should search by probing nprobe nearest centroids', async () => {
      const query = randomVector(TEST_DIMENSIONS, 999)
      const k = 10

      const results = await index.search(query, k)

      expect(results).toHaveLength(k)
      expect(results[0].id).toBeDefined()
      expect(results[0].score).toBeDefined()

      // Scores should be sorted descending (for cosine similarity)
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score)
      }
    })

    it('should only scan vectors in probed clusters', async () => {
      const query = randomVector(TEST_DIMENSIONS, 999)

      // Search with stats
      const { results, stats } = await index.searchWithStats(query, 10)

      expect(stats.clustersProbed).toBe(TEST_NPROBE)
      expect(stats.vectorsScanned).toBeLessThan(1000) // Less than brute force
      expect(stats.vectorsScanned).toBeGreaterThan(0)

      // Should scan roughly (nprobe / nlist) * total_vectors
      const expectedScanApprox = (TEST_NPROBE / TEST_NLIST) * 1000
      expect(stats.vectorsScanned).toBeCloseTo(expectedScanApprox, -1) // Within order of magnitude
    })

    it('should support configurable nprobe at query time', async () => {
      const query = randomVector(TEST_DIMENSIONS, 999)
      const k = 10

      // Search with different nprobe values
      const { stats: stats1 } = await index.searchWithStats(query, k, { nprobe: 1 })
      const { stats: stats4 } = await index.searchWithStats(query, k, { nprobe: 4 })
      const { stats: stats8 } = await index.searchWithStats(query, k, { nprobe: 8 })

      // More probing = more clusters scanned
      expect(stats1.clustersProbed).toBe(1)
      expect(stats4.clustersProbed).toBe(4)
      expect(stats8.clustersProbed).toBe(8)

      // More probing = more vectors scanned
      expect(stats4.vectorsScanned).toBeGreaterThan(stats1.vectorsScanned)
      expect(stats8.vectorsScanned).toBeGreaterThan(stats4.vectorsScanned)
    })

    it('should improve recall with higher nprobe', async () => {
      const query = randomVector(TEST_DIMENSIONS, 999)
      const k = 20

      // Get ground truth with brute force
      const groundTruth = bruteForceKNN(query, testVectors, testIds, k, 'cosine')

      // Calculate recall at different nprobe values
      const recalls: number[] = []
      for (const nprobe of [1, 2, 4, 8, 16]) {
        const results = await index.search(query, k, { nprobe })
        const recall = calculateRecall(results, groundTruth)
        recalls.push(recall)
      }

      // Recall should generally improve with higher nprobe
      expect(recalls[4]).toBeGreaterThanOrEqual(recalls[0]) // nprobe=16 vs nprobe=1

      // At nprobe=nlist (probe all), should have perfect recall
      const fullProbeResults = await index.search(query, k, { nprobe: TEST_NLIST })
      const fullRecall = calculateRecall(fullProbeResults, groundTruth)
      expect(fullRecall).toBeCloseTo(1.0, 1)
    })

    it('should throw error if index is not trained', async () => {
      const untrainedIndex = new IVFIndex({
        dimensions: TEST_DIMENSIONS,
        nlist: TEST_NLIST,
        metric: 'cosine',
      })

      await untrainedIndex.add('test', randomVector(TEST_DIMENSIONS, 1))

      const query = randomVector(TEST_DIMENSIONS, 999)
      await expect(untrainedIndex.search(query, 10)).rejects.toThrow(/not.*trained/i)
    })

    it('should handle query dimension mismatch', async () => {
      const wrongDimQuery = randomVector(64, 999) // Wrong dimensions

      await expect(index.search(wrongDimQuery, 10)).rejects.toThrow(/dimension.*mismatch/i)
    })

    it('should return fewer results if k > total vectors in probed clusters', async () => {
      // Create small index with few vectors per cluster
      const smallIndex = new IVFIndex({
        dimensions: TEST_DIMENSIONS,
        nlist: 10,
        nprobe: 1,
        metric: 'cosine',
      })

      // 20 vectors across 10 clusters = ~2 per cluster
      for (let i = 0; i < 20; i++) {
        await smallIndex.add(`v-${i}`, randomVector(TEST_DIMENSIONS, i))
      }
      await smallIndex.train()

      // Ask for more than available in single cluster
      const results = await smallIndex.search(randomVector(TEST_DIMENSIONS, 999), 10)

      // Should return what's available in probed cluster
      expect(results.length).toBeLessThanOrEqual(10)
      expect(results.length).toBeGreaterThan(0)
    })
  })

  // ============================================================================
  // TESTS: CONFIGURATION
  // ============================================================================

  describe('Configuration', () => {
    it('should support configurable number of centroids (nlist)', () => {
      const index16 = new IVFIndex({ dimensions: 128, nlist: 16 })
      const index64 = new IVFIndex({ dimensions: 128, nlist: 64 })
      const index256 = new IVFIndex({ dimensions: 128, nlist: 256 })

      expect(index16.config.nlist).toBe(16)
      expect(index64.config.nlist).toBe(64)
      expect(index256.config.nlist).toBe(256)
    })

    it('should support configurable probe count (nprobe)', () => {
      const index1 = new IVFIndex({ dimensions: 128, nlist: 64, nprobe: 1 })
      const index8 = new IVFIndex({ dimensions: 128, nlist: 64, nprobe: 8 })
      const index16 = new IVFIndex({ dimensions: 128, nlist: 64, nprobe: 16 })

      expect(index1.config.nprobe).toBe(1)
      expect(index8.config.nprobe).toBe(8)
      expect(index16.config.nprobe).toBe(16)
    })

    it('should validate nprobe <= nlist', () => {
      expect(() => {
        new IVFIndex({ dimensions: 128, nlist: 8, nprobe: 16 })
      }).toThrow(/nprobe.*nlist/i)
    })

    it('should validate nlist >= 1', () => {
      expect(() => {
        new IVFIndex({ dimensions: 128, nlist: 0 })
      }).toThrow(/nlist.*positive/i)
    })

    it('should validate nprobe >= 1', () => {
      expect(() => {
        new IVFIndex({ dimensions: 128, nlist: 8, nprobe: 0 })
      }).toThrow(/nprobe.*positive/i)
    })

    it('should use default nprobe of 1 if not specified', () => {
      const index = new IVFIndex({ dimensions: 128, nlist: 16 })
      expect(index.config.nprobe).toBe(1)
    })

    it('should support both cosine and L2 distance metrics', () => {
      const cosineIndex = new IVFIndex({ dimensions: 128, nlist: 8, metric: 'cosine' })
      const l2Index = new IVFIndex({ dimensions: 128, nlist: 8, metric: 'l2' })

      expect(cosineIndex.config.metric).toBe('cosine')
      expect(l2Index.config.metric).toBe('l2')
    })
  })

  // ============================================================================
  // TESTS: CLUSTER BALANCE
  // ============================================================================

  describe('Cluster Balance', () => {
    it('should balance cluster sizes (detect imbalanced clusters)', async () => {
      const index = new IVFIndex({
        dimensions: TEST_DIMENSIONS,
        nlist: TEST_NLIST,
        metric: 'cosine',
      })

      // Use well-clustered data
      const { vectors, ids } = createClusteredVectors(1000, TEST_DIMENSIONS, TEST_NLIST, 0.1)
      for (let i = 0; i < vectors.length; i++) {
        await index.add(ids[i], vectors[i])
      }
      await index.train()

      // Get cluster balance stats
      const balance = index.getClusterBalance()

      expect(balance.minSize).toBeGreaterThan(0)
      expect(balance.maxSize).toBeLessThan(1000)
      expect(balance.mean).toBeCloseTo(1000 / TEST_NLIST, -1)
      expect(balance.stdDev).toBeDefined()

      // Imbalance ratio (max/min) should be reasonable for well-clustered data
      const imbalanceRatio = balance.maxSize / balance.minSize
      expect(imbalanceRatio).toBeLessThan(10) // Not severely imbalanced
    })

    it('should warn about empty clusters', async () => {
      const index = new IVFIndex({
        dimensions: TEST_DIMENSIONS,
        nlist: 100, // Many clusters
        metric: 'cosine',
      })

      // Add vectors that might leave some clusters empty
      for (let i = 0; i < 150; i++) {
        await index.add(`vec-${i}`, randomVector(TEST_DIMENSIONS, i))
      }

      const result = await index.train()

      const balance = index.getClusterBalance()

      // Check for empty clusters
      if (balance.emptyClusters > 0) {
        expect(result.warnings).toContain(expect.stringMatching(/empty.*cluster/i))
      }
    })

    it('should return cluster size distribution', async () => {
      const index = new IVFIndex({
        dimensions: TEST_DIMENSIONS,
        nlist: TEST_NLIST,
        metric: 'cosine',
      })

      const { vectors, ids } = createClusteredVectors(500, TEST_DIMENSIONS, TEST_NLIST)
      for (let i = 0; i < vectors.length; i++) {
        await index.add(ids[i], vectors[i])
      }
      await index.train()

      const distribution = index.getClusterSizeDistribution()

      expect(distribution).toHaveLength(TEST_NLIST)

      // Each entry should have centroid ID and count
      distribution.forEach(entry => {
        expect(entry.centroidId).toBeGreaterThanOrEqual(0)
        expect(entry.centroidId).toBeLessThan(TEST_NLIST)
        expect(entry.count).toBeGreaterThanOrEqual(0)
      })

      // Sum should equal total vectors
      const totalFromDist = distribution.reduce((sum, e) => sum + e.count, 0)
      expect(totalFromDist).toBe(500)
    })
  })

  // ============================================================================
  // TESTS: SERIALIZATION
  // ============================================================================

  describe('Serialization', () => {
    it('should serialize/deserialize index', async () => {
      const index = new IVFIndex({
        dimensions: TEST_DIMENSIONS,
        nlist: TEST_NLIST,
        nprobe: TEST_NPROBE,
        metric: 'cosine',
      })

      const { vectors, ids } = createClusteredVectors(500, TEST_DIMENSIONS, TEST_NLIST)
      for (let i = 0; i < vectors.length; i++) {
        await index.add(ids[i], vectors[i])
      }
      await index.train()

      // Serialize
      const serialized = await index.serialize()
      expect(serialized).toBeInstanceOf(ArrayBuffer)
      expect(serialized.byteLength).toBeGreaterThan(0)

      // Deserialize
      const loadedIndex = await IVFIndex.deserialize(serialized)

      // Verify config preserved
      expect(loadedIndex.config.dimensions).toBe(TEST_DIMENSIONS)
      expect(loadedIndex.config.nlist).toBe(TEST_NLIST)
      expect(loadedIndex.config.nprobe).toBe(TEST_NPROBE)
      expect(loadedIndex.config.metric).toBe('cosine')

      // Verify centroids preserved
      const originalCentroids = index.getCentroids()
      const loadedCentroids = loadedIndex.getCentroids()
      expect(loadedCentroids.length).toBe(originalCentroids.length)

      // Verify vectors are searchable
      const query = randomVector(TEST_DIMENSIONS, 999)
      const originalResults = await index.search(query, 10)
      const loadedResults = await loadedIndex.search(query, 10)

      // Results should be identical
      expect(loadedResults).toHaveLength(originalResults.length)
      for (let i = 0; i < originalResults.length; i++) {
        expect(loadedResults[i].id).toBe(originalResults[i].id)
        expect(loadedResults[i].score).toBeCloseTo(originalResults[i].score, 5)
      }
    })

    it('should serialize to JSON format', async () => {
      const index = new IVFIndex({
        dimensions: TEST_DIMENSIONS,
        nlist: 8,
        metric: 'cosine',
      })

      for (let i = 0; i < 100; i++) {
        await index.add(`vec-${i}`, randomVector(TEST_DIMENSIONS, i))
      }
      await index.train()

      const json = await index.toJSON()

      expect(json.config).toEqual({
        dimensions: TEST_DIMENSIONS,
        nlist: 8,
        nprobe: 1,
        metric: 'cosine',
      })
      expect(json.centroids).toHaveLength(8)
      expect(json.invertedLists).toHaveLength(8)
      expect(json.vectorCount).toBe(100)
      expect(json.trained).toBe(true)
    })

    it('should load from JSON format', async () => {
      const index = new IVFIndex({
        dimensions: TEST_DIMENSIONS,
        nlist: 8,
        metric: 'cosine',
      })

      for (let i = 0; i < 100; i++) {
        await index.add(`vec-${i}`, randomVector(TEST_DIMENSIONS, i))
      }
      await index.train()

      const json = await index.toJSON()
      const loadedIndex = await IVFIndex.fromJSON(json)

      expect(loadedIndex.config.nlist).toBe(8)
      expect(loadedIndex.isTrained()).toBe(true)

      // Should be searchable
      const results = await loadedIndex.search(randomVector(TEST_DIMENSIONS, 999), 5)
      expect(results.length).toBe(5)
    })

    it('should include version in serialized format', async () => {
      const index = new IVFIndex({ dimensions: TEST_DIMENSIONS, nlist: 8 })

      for (let i = 0; i < 50; i++) {
        await index.add(`vec-${i}`, randomVector(TEST_DIMENSIONS, i))
      }
      await index.train()

      const serialized = await index.serialize()
      const view = new DataView(serialized)

      // First 4 bytes should be magic number/version
      const magic = String.fromCharCode(
        view.getUint8(0),
        view.getUint8(1),
        view.getUint8(2),
        view.getUint8(3)
      )
      expect(magic).toBe('IVF1')
    })
  })

  // ============================================================================
  // TESTS: INCREMENTAL OPERATIONS
  // ============================================================================

  describe('Incremental Operations', () => {
    it('should support incremental vector addition', async () => {
      const index = new IVFIndex({
        dimensions: TEST_DIMENSIONS,
        nlist: 8,
        metric: 'cosine',
      })

      // Initial batch
      for (let i = 0; i < 100; i++) {
        await index.add(`batch1-${i}`, randomVector(TEST_DIMENSIONS, i))
      }
      await index.train()

      expect(index.size()).toBe(100)

      // Add more vectors without retraining
      for (let i = 0; i < 50; i++) {
        await index.add(`batch2-${i}`, randomVector(TEST_DIMENSIONS, i + 1000))
      }

      expect(index.size()).toBe(150)

      // New vectors should be assigned to existing clusters
      const assignment = await index.getVectorAssignment('batch2-0')
      expect(assignment).toBeDefined()
      expect(assignment!.centroidId).toBeGreaterThanOrEqual(0)
      expect(assignment!.centroidId).toBeLessThan(8)

      // Search should find vectors from both batches
      const query = randomVector(TEST_DIMENSIONS, 1000) // Similar to batch2
      const results = await index.search(query, 20, { nprobe: 8 })

      const batch2Hits = results.filter(r => r.id.startsWith('batch2-')).length
      expect(batch2Hits).toBeGreaterThan(0)
    })

    it('should support vector updates', async () => {
      const index = new IVFIndex({
        dimensions: TEST_DIMENSIONS,
        nlist: 8,
        metric: 'cosine',
      })

      for (let i = 0; i < 100; i++) {
        await index.add(`vec-${i}`, randomVector(TEST_DIMENSIONS, i))
      }
      await index.train()

      // Get original assignment
      const originalAssignment = await index.getVectorAssignment('vec-0')

      // Update vector with very different values
      const newVector = randomVector(TEST_DIMENSIONS, 9999)
      await index.update('vec-0', newVector)

      // Assignment might have changed
      const newAssignment = await index.getVectorAssignment('vec-0')
      expect(newAssignment).toBeDefined()

      // Vector should be retrievable with new values
      const retrieved = await index.getVector('vec-0')
      expect(retrieved).toEqual(newVector)
    })

    it('should mark index as needing retraining after significant changes', async () => {
      const index = new IVFIndex({
        dimensions: TEST_DIMENSIONS,
        nlist: 8,
        metric: 'cosine',
      })

      for (let i = 0; i < 100; i++) {
        await index.add(`vec-${i}`, randomVector(TEST_DIMENSIONS, i))
      }
      await index.train()

      expect(index.needsRetraining()).toBe(false)

      // Add many new vectors (e.g., > 50% of original)
      for (let i = 0; i < 100; i++) {
        await index.add(`new-${i}`, randomVector(TEST_DIMENSIONS, i + 10000))
      }

      expect(index.needsRetraining()).toBe(true)
    })

    it('should allow optional retraining after incremental additions', async () => {
      const index = new IVFIndex({
        dimensions: TEST_DIMENSIONS,
        nlist: 8,
        metric: 'cosine',
      })

      for (let i = 0; i < 100; i++) {
        await index.add(`vec-${i}`, randomVector(TEST_DIMENSIONS, i))
      }
      await index.train()

      // Add more vectors
      for (let i = 0; i < 50; i++) {
        await index.add(`new-${i}`, randomVector(TEST_DIMENSIONS, i + 5000))
      }

      // Retrain to incorporate new vectors properly
      const result = await index.train({ incremental: true })

      expect(result.converged).toBe(true)
      expect(index.needsRetraining()).toBe(false)
    })
  })

  // ============================================================================
  // TESTS: EMPTY CLUSTER HANDLING
  // ============================================================================

  describe('Empty Cluster Handling', () => {
    it('should handle empty clusters gracefully', async () => {
      const index = new IVFIndex({
        dimensions: TEST_DIMENSIONS,
        nlist: 20, // More clusters than data naturally forms
        metric: 'cosine',
      })

      // Add tightly clustered data that won't fill all clusters
      const center = randomVector(TEST_DIMENSIONS, 1)
      for (let i = 0; i < 50; i++) {
        const vec = new Float32Array(TEST_DIMENSIONS)
        for (let d = 0; d < TEST_DIMENSIONS; d++) {
          vec[d] = center[d] + (Math.random() - 0.5) * 0.01
        }
        await index.add(`vec-${i}`, normalizeVector(vec))
      }

      await index.train()

      // Some clusters might be empty - should still work
      const query = center
      const results = await index.search(query, 10)

      expect(results.length).toBeGreaterThan(0)
    })

    it('should skip empty clusters during search', async () => {
      const index = new IVFIndex({
        dimensions: TEST_DIMENSIONS,
        nlist: 10,
        metric: 'cosine',
      })

      // Create data that clusters in only a few areas
      for (let i = 0; i < 30; i++) {
        await index.add(`vec-${i}`, randomVector(TEST_DIMENSIONS, i % 3)) // Only 3 distinct patterns
      }

      await index.train()

      const { stats } = await index.searchWithStats(
        randomVector(TEST_DIMENSIONS, 0),
        10,
        { nprobe: 5 }
      )

      // Should have probed 5 clusters, but some may have been empty
      // Effective probed should be <= requested
      expect(stats.clustersProbed).toBeLessThanOrEqual(5)
      expect(stats.emptyClustersPassed).toBeDefined()
    })

    it('should relocate centroids from empty clusters during training', async () => {
      const index = new IVFIndex({
        dimensions: TEST_DIMENSIONS,
        nlist: 10,
        relocateEmptyClusters: true,
        metric: 'cosine',
      })

      for (let i = 0; i < 50; i++) {
        await index.add(`vec-${i}`, randomVector(TEST_DIMENSIONS, i))
      }

      await index.train()

      // After training with relocation, should have no empty clusters
      const balance = index.getClusterBalance()
      expect(balance.emptyClusters).toBe(0)
    })
  })

  // ============================================================================
  // TESTS: RECALL MEASUREMENT
  // ============================================================================

  describe('Recall Measurement', () => {
    it('should compute recall at different nprobe values', async () => {
      const index = new IVFIndex({
        dimensions: TEST_DIMENSIONS,
        nlist: 16,
        metric: 'cosine',
      })

      const { vectors, ids } = createClusteredVectors(1000, TEST_DIMENSIONS, 16)
      for (let i = 0; i < vectors.length; i++) {
        await index.add(ids[i], vectors[i])
      }
      await index.train()

      // Generate queries
      const queries = Array.from({ length: 10 }, (_, i) =>
        randomVector(TEST_DIMENSIONS, i * 100)
      )

      // Compute recall at different nprobe values
      const recallMetrics = await index.evaluateRecall(queries, {
        k: 10,
        nprobeValues: [1, 2, 4, 8, 16],
        groundTruthFn: (query, k) => bruteForceKNN(query, vectors, ids, k, 'cosine'),
      })

      expect(recallMetrics).toHaveLength(5)

      // Recall should increase with nprobe
      for (let i = 0; i < recallMetrics.length - 1; i++) {
        expect(recallMetrics[i + 1].meanRecall).toBeGreaterThanOrEqual(
          recallMetrics[i].meanRecall * 0.95 // Allow small variance
        )
      }

      // At nprobe=nlist, recall should be very high
      expect(recallMetrics[4].meanRecall).toBeGreaterThan(0.95)
    })

    it('should report recall@1, recall@10, recall@100', async () => {
      const index = new IVFIndex({
        dimensions: TEST_DIMENSIONS,
        nlist: 8,
        nprobe: 4,
        metric: 'cosine',
      })

      const { vectors, ids } = createClusteredVectors(500, TEST_DIMENSIONS, 8)
      for (let i = 0; i < vectors.length; i++) {
        await index.add(ids[i], vectors[i])
      }
      await index.train()

      const query = randomVector(TEST_DIMENSIONS, 999)

      const recalls = await index.computeRecalls(query, {
        kValues: [1, 10, 100],
        groundTruthFn: (q, k) => bruteForceKNN(q, vectors, ids, k, 'cosine'),
      })

      expect(recalls['recall@1']).toBeDefined()
      expect(recalls['recall@10']).toBeDefined()
      expect(recalls['recall@100']).toBeDefined()

      // Higher k typically has higher recall for approximate methods
      expect(recalls['recall@100']).toBeGreaterThanOrEqual(recalls['recall@1'])
    })
  })

  // ============================================================================
  // TESTS: STATISTICS AND INFO
  // ============================================================================

  describe('Statistics', () => {
    it('should return comprehensive index statistics', async () => {
      const index = new IVFIndex({
        dimensions: TEST_DIMENSIONS,
        nlist: TEST_NLIST,
        nprobe: TEST_NPROBE,
        metric: 'cosine',
      })

      const { vectors, ids } = createClusteredVectors(500, TEST_DIMENSIONS, TEST_NLIST)
      for (let i = 0; i < vectors.length; i++) {
        await index.add(ids[i], vectors[i])
      }
      await index.train()

      const stats = index.getStats()

      expect(stats.vectorCount).toBe(500)
      expect(stats.dimensions).toBe(TEST_DIMENSIONS)
      expect(stats.nlist).toBe(TEST_NLIST)
      expect(stats.nprobe).toBe(TEST_NPROBE)
      expect(stats.metric).toBe('cosine')
      expect(stats.trained).toBe(true)
      expect(stats.memoryUsageBytes).toBeGreaterThan(0)
      expect(stats.avgVectorsPerCluster).toBeCloseTo(500 / TEST_NLIST, 0)
    })

    it('should track search latency statistics', async () => {
      const index = new IVFIndex({
        dimensions: TEST_DIMENSIONS,
        nlist: 8,
        nprobe: 2,
        metric: 'cosine',
      })

      const { vectors, ids } = createClusteredVectors(200, TEST_DIMENSIONS, 8)
      for (let i = 0; i < vectors.length; i++) {
        await index.add(ids[i], vectors[i])
      }
      await index.train()

      // Run some searches
      for (let i = 0; i < 10; i++) {
        await index.search(randomVector(TEST_DIMENSIONS, i), 10)
      }

      const latencyStats = index.getLatencyStats()

      expect(latencyStats.searchCount).toBe(10)
      expect(latencyStats.avgLatencyMs).toBeGreaterThan(0)
      expect(latencyStats.p50LatencyMs).toBeGreaterThan(0)
      expect(latencyStats.p99LatencyMs).toBeGreaterThanOrEqual(latencyStats.p50LatencyMs)
    })
  })
})
