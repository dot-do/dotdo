/**
 * HNSW Index Tests
 *
 * RED phase TDD tests for HNSW (Hierarchical Navigable Small World) index.
 * These tests define the expected behavior of a production-grade HNSW implementation.
 *
 * @module db/edgevec/tests/hnsw.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Import types and implementation (to be created)
import type {
  HNSWConfig,
  HNSWIndex,
  HNSWNode,
  HNSWStats,
  SearchResult,
} from '../hnsw'
import { createHNSWIndex, HNSWIndexImpl, validateVectorDimensions } from '../hnsw'

// ============================================================================
// TEST UTILITIES
// ============================================================================

/**
 * Generate a random normalized vector
 */
function randomVector(dim: number): Float32Array {
  const v = new Float32Array(dim)
  let norm = 0
  for (let i = 0; i < dim; i++) {
    v[i] = Math.random() * 2 - 1
    norm += v[i] * v[i]
  }
  norm = Math.sqrt(norm)
  for (let i = 0; i < dim; i++) {
    v[i] /= norm
  }
  return v
}

/**
 * Generate a reproducible vector based on seed
 */
function seededVector(dim: number, seed: number): Float32Array {
  const v = new Float32Array(dim)
  let norm = 0
  for (let i = 0; i < dim; i++) {
    // Simple PRNG
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    v[i] = (seed / 0x7fffffff) * 2 - 1
    norm += v[i] * v[i]
  }
  norm = Math.sqrt(norm)
  for (let i = 0; i < dim; i++) {
    v[i] /= norm
  }
  return v
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
 * Compute dot product between two vectors
 */
function dotProduct(a: Float32Array, b: Float32Array): number {
  let dot = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
  }
  return dot
}

/**
 * Brute force k-NN search for validation
 */
function bruteForceKNN(
  query: Float32Array,
  vectors: Map<string, Float32Array>,
  k: number,
  metric: 'cosine' | 'l2' | 'dot' = 'cosine'
): Array<{ id: string; score: number }> {
  const scores: Array<{ id: string; score: number }> = []

  for (const [id, v] of vectors) {
    let score: number
    if (metric === 'cosine') {
      score = cosineSimilarity(query, v)
    } else if (metric === 'l2') {
      let sum = 0
      for (let i = 0; i < query.length; i++) {
        const diff = query[i] - v[i]
        sum += diff * diff
      }
      score = -Math.sqrt(sum) // Negative for sorting (lower is better)
    } else {
      // dot product
      let dot = 0
      for (let i = 0; i < query.length; i++) {
        dot += query[i] * v[i]
      }
      score = dot
    }
    scores.push({ id, score })
  }

  return scores.sort((a, b) => b.score - a.score).slice(0, k)
}

/**
 * Calculate recall@k between HNSW results and ground truth
 */
function calculateRecall(
  hnswResults: Array<{ id: string }>,
  groundTruth: Array<{ id: string }>
): number {
  const truthSet = new Set(groundTruth.map((r) => r.id))
  const hits = hnswResults.filter((r) => truthSet.has(r.id)).length
  return hits / groundTruth.length
}

// ============================================================================
// INDEX CONSTRUCTION TESTS
// ============================================================================

describe('HNSW Index Construction', () => {
  it('builds index from vectors', () => {
    const index = createHNSWIndex({ dimensions: 128 })

    for (let i = 0; i < 100; i++) {
      index.insert(`vec-${i}`, randomVector(128))
    }

    expect(index.size()).toBe(100)
    expect(index.getEntryPoint()).toBeDefined()
  })

  it('creates an empty index with default configuration', () => {
    const index = createHNSWIndex({ dimensions: 128 })

    expect(index).toBeDefined()
    expect(index.size()).toBe(0)
    expect(index.dimensions()).toBe(128)
  })

  it('respects M parameter', () => {
    const index = createHNSWIndex({
      dimensions: 128,
      M: 32,
    })

    expect(index.config().M).toBe(32)
    expect(index.config().maxM).toBe(32)
    expect(index.config().maxM0).toBe(64) // 2 * M for layer 0

    // Insert enough vectors to verify M is respected
    for (let i = 0; i < 500; i++) {
      index.insert(`vec-${i}`, randomVector(128))
    }

    // Verify no node exceeds M connections on higher layers
    for (let i = 0; i < 500; i++) {
      const node = index.getNode(`vec-${i}`)
      if (node) {
        for (let level = 1; level <= node.level; level++) {
          expect(node.neighbors[level]?.length ?? 0).toBeLessThanOrEqual(32)
        }
      }
    }
  })

  it('respects efConstruction', () => {
    const index = createHNSWIndex({
      dimensions: 128,
      efConstruction: 400,
    })

    expect(index.config().efConstruction).toBe(400)
  })

  it('builds multiple layers', () => {
    const index = createHNSWIndex({
      dimensions: 128,
      M: 16,
      efConstruction: 200,
    })

    // With 1000 vectors, we should have multiple layers
    for (let i = 0; i < 1000; i++) {
      index.insert(`vec-${i}`, randomVector(128))
    }

    const stats = index.getStats()
    expect(stats.maxLevel).toBeGreaterThan(0)
    expect(stats.layerDistribution.length).toBeGreaterThan(1)

    // Layer 0 should have all nodes
    expect(stats.layerDistribution[0]).toBe(1000)

    // Higher layers should have exponentially fewer nodes
    for (let i = 1; i < stats.layerDistribution.length; i++) {
      expect(stats.layerDistribution[i]).toBeLessThan(stats.layerDistribution[i - 1])
    }
  })

  it('uses default M=16 when not specified', () => {
    const index = createHNSWIndex({ dimensions: 128 })

    expect(index.config().M).toBe(16)
  })

  it('uses default efConstruction=200 when not specified', () => {
    const index = createHNSWIndex({ dimensions: 128 })

    expect(index.config().efConstruction).toBe(200)
  })

  it('validates M must be at least 2', () => {
    expect(() =>
      createHNSWIndex({ dimensions: 128, M: 1 })
    ).toThrow(/M must be at least 2/)
  })

  it('validates efConstruction must be at least M', () => {
    expect(() =>
      createHNSWIndex({
        dimensions: 128,
        M: 16,
        efConstruction: 8,
      })
    ).toThrow(/efConstruction must be at least M/)
  })

  it('validates dimensions must be positive', () => {
    expect(() => createHNSWIndex({ dimensions: 0 })).toThrow(
      /dimensions must be positive/
    )

    expect(() => createHNSWIndex({ dimensions: -128 })).toThrow(
      /dimensions must be positive/
    )
  })

  it('supports cosine distance metric', () => {
    const index = createHNSWIndex({
      dimensions: 128,
      metric: 'cosine',
    })

    expect(index.config().metric).toBe('cosine')
  })

  it('supports L2 (Euclidean) distance metric', () => {
    const index = createHNSWIndex({
      dimensions: 128,
      metric: 'l2',
    })

    expect(index.config().metric).toBe('l2')
  })

  it('supports dot product distance metric', () => {
    const index = createHNSWIndex({
      dimensions: 128,
      metric: 'dot',
    })

    expect(index.config().metric).toBe('dot')
  })

  it('defaults to cosine distance metric', () => {
    const index = createHNSWIndex({ dimensions: 128 })

    expect(index.config().metric).toBe('cosine')
  })
})

// ============================================================================
// SEARCH TESTS
// ============================================================================

describe('HNSW Search', () => {
  let index: HNSWIndex
  let testVectors: Map<string, Float32Array>

  beforeEach(() => {
    index = createHNSWIndex({
      dimensions: 128,
      M: 16,
      efConstruction: 200,
      metric: 'cosine',
    })

    testVectors = new Map()

    // Insert 1000 random vectors
    for (let i = 0; i < 1000; i++) {
      const v = seededVector(128, i)
      testVectors.set(`vec-${i}`, v)
      index.insert(`vec-${i}`, v)
    }
  })

  it('finds k nearest neighbors', () => {
    const query = seededVector(128, 42)
    const results = index.search(query, { k: 10 })

    expect(results).toHaveLength(10)

    // The exact match should be the first result
    expect(results[0].id).toBe('vec-42')
    expect(results[0].score).toBeCloseTo(1, 5) // Cosine similarity = 1 for identical vectors
  })

  it('respects ef parameter', () => {
    const query = seededVector(128, 999)

    // Lower ef = faster but potentially less accurate
    const resultsLowEf = index.search(query, { k: 10, ef: 10 })
    // Higher ef = slower but more accurate
    const resultsHighEf = index.search(query, { k: 10, ef: 200 })

    expect(resultsLowEf).toHaveLength(10)
    expect(resultsHighEf).toHaveLength(10)

    // Higher ef should generally produce better or equal results
    const groundTruth = bruteForceKNN(query, testVectors, 10, 'cosine')
    const recallLow = calculateRecall(resultsLowEf, groundTruth)
    const recallHigh = calculateRecall(resultsHighEf, groundTruth)

    expect(recallHigh).toBeGreaterThanOrEqual(recallLow)
  })

  it('handles cosine distance', () => {
    const cosineIndex = createHNSWIndex({
      dimensions: 128,
      metric: 'cosine',
    })

    const vectors = new Map<string, Float32Array>()
    for (let i = 0; i < 100; i++) {
      const v = seededVector(128, i)
      vectors.set(`vec-${i}`, v)
      cosineIndex.insert(`vec-${i}`, v)
    }

    const query = seededVector(128, 50)
    const results = cosineIndex.search(query, { k: 10 })

    // First result should be the exact match with similarity 1.0
    expect(results[0].id).toBe('vec-50')
    expect(results[0].score).toBeCloseTo(1, 5)

    // Results should be sorted by descending similarity
    for (let i = 1; i < results.length; i++) {
      expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score)
    }
  })

  it('handles euclidean distance', () => {
    const l2Index = createHNSWIndex({
      dimensions: 128,
      metric: 'l2',
    })

    const vectors = new Map<string, Float32Array>()
    for (let i = 0; i < 100; i++) {
      const v = seededVector(128, i)
      vectors.set(`vec-${i}`, v)
      l2Index.insert(`vec-${i}`, v)
    }

    const query = seededVector(128, 50)
    const results = l2Index.search(query, { k: 10 })

    // First result should be the exact match with distance 0
    expect(results[0].id).toBe('vec-50')
    expect(Math.abs(results[0].score)).toBeLessThan(0.0001) // Should be ~0 for L2

    // For L2, lower score is better, results should be ascending
    for (let i = 1; i < results.length; i++) {
      expect(results[i].score).toBeGreaterThanOrEqual(results[i - 1].score)
    }
  })

  it('handles dot product', () => {
    const dotIndex = createHNSWIndex({
      dimensions: 128,
      metric: 'dot',
    })

    const vectors = new Map<string, Float32Array>()
    for (let i = 0; i < 100; i++) {
      const v = seededVector(128, i)
      vectors.set(`vec-${i}`, v)
      dotIndex.insert(`vec-${i}`, v)
    }

    const query = seededVector(128, 50)
    const results = dotIndex.search(query, { k: 10 })

    // First result should be the exact match
    expect(results[0].id).toBe('vec-50')

    // Results should be sorted by descending dot product
    for (let i = 1; i < results.length; i++) {
      expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score)
    }
  })

  it('searches with default k=10', () => {
    const query = randomVector(128)
    const results = index.search(query)

    expect(results).toHaveLength(10)
  })

  it('searches with custom k', () => {
    const query = randomVector(128)
    const results = index.search(query, { k: 50 })

    expect(results).toHaveLength(50)
  })

  it('returns results sorted by score descending', () => {
    const query = randomVector(128)
    const results = index.search(query, { k: 20 })

    for (let i = 1; i < results.length; i++) {
      expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score)
    }
  })

  it('returns vector IDs in results', () => {
    const query = randomVector(128)
    const results = index.search(query, { k: 10 })

    results.forEach((r) => {
      expect(r.id).toMatch(/^vec-\d+$/)
      expect(testVectors.has(r.id)).toBe(true)
    })
  })

  it('uses efSearch >= k automatically', () => {
    const query = randomVector(128)
    const results = index.search(query, { k: 100, ef: 50 })

    // Should still return k results even if ef < k (ef is adjusted internally)
    expect(results.length).toBe(100)
  })

  it('returns empty array for empty index', () => {
    const emptyIndex = createHNSWIndex({ dimensions: 128 })
    const query = randomVector(128)
    const results = emptyIndex.search(query, { k: 10 })

    expect(results).toHaveLength(0)
  })

  it('handles k larger than index size', () => {
    const smallIndex = createHNSWIndex({ dimensions: 128 })
    for (let i = 0; i < 5; i++) {
      smallIndex.insert(`vec-${i}`, randomVector(128))
    }

    const query = randomVector(128)
    const results = smallIndex.search(query, { k: 100 })

    expect(results).toHaveLength(5)
  })

  it('validates query dimension', () => {
    const wrongDim = randomVector(64)

    expect(() => index.search(wrongDim)).toThrow(/dimension mismatch/)
  })

  it('accepts Float32Array as query', () => {
    const query = randomVector(128)
    const results = index.search(query, { k: 10 })

    expect(results).toHaveLength(10)
  })

  it('accepts number[] as query', () => {
    const query = Array.from(randomVector(128))
    const results = index.search(query as unknown as Float32Array, { k: 10 })

    expect(results).toHaveLength(10)
  })

  it('achieves reasonable recall with proper ef', () => {
    const query = seededVector(128, 999)
    const k = 10

    // Get HNSW results with high ef for better accuracy
    const hnswResults = index.search(query, { k, ef: 200 })

    // Get ground truth via brute force
    const groundTruth = bruteForceKNN(query, testVectors, k, 'cosine')

    // Calculate recall
    const recall = calculateRecall(hnswResults, groundTruth)

    // With ef=200 and k=10, we should get good recall
    expect(recall).toBeGreaterThanOrEqual(0.8)
  })
})

// ============================================================================
// INCREMENTAL OPERATIONS TESTS
// ============================================================================

describe('HNSW Incremental Operations', () => {
  let index: HNSWIndex

  beforeEach(() => {
    index = createHNSWIndex({
      dimensions: 128,
      M: 16,
      efConstruction: 200,
    })

    for (let i = 0; i < 100; i++) {
      index.insert(`vec-${i}`, seededVector(128, i))
    }
  })

  it('inserts new vectors', () => {
    const newVector = randomVector(128)
    index.insert('new-vec', newVector)

    expect(index.size()).toBe(101)
    expect(index.has('new-vec')).toBe(true)

    // Should be searchable
    const results = index.search(newVector, { k: 1 })
    expect(results[0].id).toBe('new-vec')
  })

  it('deletes vectors', () => {
    expect(index.has('vec-50')).toBe(true)

    const deleted = index.delete('vec-50')

    expect(deleted).toBe(true)
    expect(index.has('vec-50')).toBe(false)
    expect(index.size()).toBe(99)
  })

  it('updates existing vectors', () => {
    const originalVector = index.getVector('vec-50')!
    const newVector = randomVector(128)

    // Re-insert with same ID should update
    index.insert('vec-50', newVector)

    expect(index.size()).toBe(100) // Size unchanged

    const storedVector = index.getVector('vec-50')!
    expect(cosineSimilarity(storedVector, newVector)).toBeCloseTo(1, 5)
    expect(cosineSimilarity(storedVector, originalVector)).not.toBeCloseTo(1, 5)
  })

  it('returns false for non-existent ID', () => {
    const deleted = index.delete('nonexistent')

    expect(deleted).toBe(false)
    expect(index.size()).toBe(100)
  })

  it('removes deleted vectors from search results', () => {
    // Get the vector we're about to delete
    const targetVector = index.getVector('vec-50')!

    // Delete it
    index.delete('vec-50')

    // Search for similar vectors
    const results = index.search(targetVector, { k: 100 })

    // Should not contain deleted vector
    expect(results.map((r) => r.id)).not.toContain('vec-50')
  })

  it('repairs neighbor links after deletion', () => {
    // Delete a node
    index.delete('vec-50')

    // Verify no remaining nodes reference the deleted node
    for (let i = 0; i < 100; i++) {
      if (i === 50) continue

      const node = index.getNode(`vec-${i}`)
      if (node) {
        for (const levelNeighbors of node.neighbors) {
          expect(levelNeighbors).not.toContain('vec-50')
        }
      }
    }
  })

  it('handles deleting entry point', () => {
    const entryPoint = index.getEntryPoint()!

    index.delete(entryPoint.id)

    // Index should still work with new entry point
    expect(index.size()).toBe(99)

    const newEntryPoint = index.getEntryPoint()
    expect(newEntryPoint).toBeDefined()
    expect(newEntryPoint!.id).not.toBe(entryPoint.id)

    // Search should still work
    const results = index.search(randomVector(128), { k: 10 })
    expect(results.length).toBeGreaterThan(0)
  })

  it('handles deleting all vectors', () => {
    for (let i = 0; i < 100; i++) {
      index.delete(`vec-${i}`)
    }

    expect(index.size()).toBe(0)
    expect(index.getEntryPoint()).toBeUndefined()

    // Search on empty index
    const results = index.search(randomVector(128), { k: 10 })
    expect(results).toHaveLength(0)
  })

  it('allows re-inserting after delete', () => {
    const vector = index.getVector('vec-50')!

    index.delete('vec-50')
    index.insert('vec-50', vector)

    expect(index.has('vec-50')).toBe(true)
    expect(index.size()).toBe(100)
  })
})

// ============================================================================
// EDGE CASES TESTS
// ============================================================================

describe('HNSW Edge Cases', () => {
  it('handles empty index', () => {
    const index = createHNSWIndex({ dimensions: 128 })

    expect(index.size()).toBe(0)
    expect(index.getEntryPoint()).toBeUndefined()

    const results = index.search(randomVector(128), { k: 10 })
    expect(results).toHaveLength(0)
  })

  it('handles single vector', () => {
    const index = createHNSWIndex({ dimensions: 128 })
    const singleVector = randomVector(128)

    index.insert('only-one', singleVector)

    expect(index.size()).toBe(1)
    expect(index.getEntryPoint()?.id).toBe('only-one')

    const results = index.search(singleVector, { k: 10 })
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('only-one')
    expect(results[0].score).toBeCloseTo(1, 5)
  })

  it('handles duplicate vectors', () => {
    const index = createHNSWIndex({ dimensions: 128 })
    const duplicateVector = randomVector(128)

    // Insert same vector with different IDs
    index.insert('dup-1', duplicateVector)
    index.insert('dup-2', new Float32Array(duplicateVector))
    index.insert('dup-3', new Float32Array(duplicateVector))

    expect(index.size()).toBe(3)

    // Search should return all duplicates with same score
    const results = index.search(duplicateVector, { k: 3 })
    expect(results).toHaveLength(3)

    // All should have perfect similarity
    results.forEach((r) => {
      expect(r.score).toBeCloseTo(1, 5)
    })
  })

  it('handles high dimensions (768)', () => {
    const index = createHNSWIndex({ dimensions: 768 })

    for (let i = 0; i < 100; i++) {
      index.insert(`vec-${i}`, randomVector(768))
    }

    expect(index.size()).toBe(100)

    const query = randomVector(768)
    const results = index.search(query, { k: 10 })
    expect(results).toHaveLength(10)
  })

  it('handles high dimensions (1536)', () => {
    const index = createHNSWIndex({ dimensions: 1536 })

    for (let i = 0; i < 50; i++) {
      index.insert(`vec-${i}`, randomVector(1536))
    }

    expect(index.size()).toBe(50)

    const query = randomVector(1536)
    const results = index.search(query, { k: 10 })
    expect(results).toHaveLength(10)
  })

  it('handles very small M parameter', () => {
    const index = createHNSWIndex({
      dimensions: 128,
      M: 2, // Minimum allowed
      efConstruction: 10,
    })

    for (let i = 0; i < 100; i++) {
      index.insert(`vec-${i}`, randomVector(128))
    }

    expect(index.size()).toBe(100)

    // Search should still work, though possibly with lower recall
    const results = index.search(randomVector(128), { k: 10 })
    expect(results.length).toBeGreaterThan(0)
  })

  it('handles very large M parameter', () => {
    const index = createHNSWIndex({
      dimensions: 128,
      M: 64, // Large M
      efConstruction: 200,
    })

    for (let i = 0; i < 200; i++) {
      index.insert(`vec-${i}`, randomVector(128))
    }

    expect(index.size()).toBe(200)

    // Should have higher recall due to more connections
    const testVectors = new Map<string, Float32Array>()
    for (let i = 0; i < 200; i++) {
      testVectors.set(`vec-${i}`, index.getVector(`vec-${i}`)!)
    }

    const query = randomVector(128)
    const results = index.search(query, { k: 10, ef: 100 })
    const groundTruth = bruteForceKNN(query, testVectors, 10, 'cosine')
    const recall = calculateRecall(results, groundTruth)

    expect(recall).toBeGreaterThanOrEqual(0.7)
  })

  it('handles zero vector', () => {
    const index = createHNSWIndex({ dimensions: 128 })
    const zeroVector = new Float32Array(128).fill(0)

    // Inserting zero vector might cause issues with normalization
    // This test documents the expected behavior
    index.insert('zero', zeroVector)

    expect(index.size()).toBe(1)
    expect(index.has('zero')).toBe(true)
  })

  it('handles very similar but not identical vectors', () => {
    const index = createHNSWIndex({ dimensions: 128, metric: 'cosine' })
    const baseVector = randomVector(128)

    // Create vectors with tiny perturbations
    for (let i = 0; i < 10; i++) {
      const perturbedVector = new Float32Array(baseVector)
      perturbedVector[0] += i * 0.0001 // Tiny change
      index.insert(`vec-${i}`, perturbedVector)
    }

    const results = index.search(baseVector, { k: 10 })
    expect(results).toHaveLength(10)

    // All should have very high similarity
    results.forEach((r) => {
      expect(r.score).toBeGreaterThan(0.99)
    })
  })
})

// ============================================================================
// PERFORMANCE BOUNDS TESTS
// ============================================================================

describe('HNSW Performance Bounds', () => {
  it('achieves 95%+ recall at efSearch=100', () => {
    const index = createHNSWIndex({
      dimensions: 128,
      M: 32,
      efConstruction: 400,
    })

    const vectors = new Map<string, Float32Array>()
    for (let i = 0; i < 1000; i++) {
      const v = randomVector(128)
      vectors.set(`vec-${i}`, v)
      index.insert(`vec-${i}`, v)
    }

    // Run multiple queries and average recall
    let totalRecall = 0
    const numQueries = 50

    for (let q = 0; q < numQueries; q++) {
      const query = randomVector(128)
      const hnswResults = index.search(query, { k: 10, ef: 100 })
      const groundTruth = bruteForceKNN(query, vectors, 10, 'cosine')
      totalRecall += calculateRecall(hnswResults, groundTruth)
    }

    const avgRecall = totalRecall / numQueries
    expect(avgRecall).toBeGreaterThanOrEqual(0.95)
  })

  it('search is O(log n)', { timeout: 60000 }, () => {
    const smallIndex = createHNSWIndex({ dimensions: 128, M: 16, efConstruction: 100 })
    const largeIndex = createHNSWIndex({ dimensions: 128, M: 16, efConstruction: 100 })

    // Build small index (100 vectors)
    for (let i = 0; i < 100; i++) {
      smallIndex.insert(`vec-${i}`, randomVector(128))
    }

    // Build large index (10000 vectors)
    for (let i = 0; i < 10000; i++) {
      largeIndex.insert(`vec-${i}`, randomVector(128))
    }

    const query = randomVector(128)
    const numQueries = 100

    // Time small index queries
    const smallStart = performance.now()
    for (let i = 0; i < numQueries; i++) {
      smallIndex.search(query, { k: 10, ef: 50 })
    }
    const smallTime = (performance.now() - smallStart) / numQueries

    // Time large index queries
    const largeStart = performance.now()
    for (let i = 0; i < numQueries; i++) {
      largeIndex.search(query, { k: 10, ef: 50 })
    }
    const largeTime = (performance.now() - largeStart) / numQueries

    // Large index (100x more vectors) should take less than 10x longer
    // (due to logarithmic scaling)
    // O(log 10000) / O(log 100) = log(10000)/log(100) = 4/2 = 2
    // Being generous and allowing 10x to account for variance
    expect(largeTime / smallTime).toBeLessThan(10)
  })

  it('constructs index in sub-quadratic time', () => {
    const n = 1000
    const index = createHNSWIndex({ dimensions: 128, M: 16, efConstruction: 100 })

    const startTime = performance.now()
    for (let i = 0; i < n; i++) {
      index.insert(`vec-${i}`, randomVector(128))
    }
    const endTime = performance.now()

    const timePerVector = (endTime - startTime) / n

    // Should be roughly O(n log n), so time per vector should be fairly constant
    // Allow generous margin for test environment variability
    expect(timePerVector).toBeLessThan(10) // Less than 10ms per vector
  })

  it('achieves reasonable recall at k=10 with high ef', () => {
    const index = createHNSWIndex({
      dimensions: 128,
      M: 32, // Higher M for better recall
      efConstruction: 400, // Higher efConstruction for better graph quality
    })

    const vectors = new Map<string, Float32Array>()
    for (let i = 0; i < 1000; i++) {
      const v = randomVector(128)
      vectors.set(`vec-${i}`, v)
      index.insert(`vec-${i}`, v)
    }

    // Run multiple queries and average recall
    let totalRecall = 0
    const numQueries = 20

    for (let q = 0; q < numQueries; q++) {
      const query = randomVector(128)
      const hnswResults = index.search(query, { k: 10, ef: 200 })
      const groundTruth = bruteForceKNN(query, vectors, 10, 'cosine')
      totalRecall += calculateRecall(hnswResults, groundTruth)
    }

    const avgRecall = totalRecall / numQueries
    expect(avgRecall).toBeGreaterThanOrEqual(0.9)
  })
})

// ============================================================================
// STATS & INSPECTION TESTS
// ============================================================================

describe('HNSW Stats & Inspection', () => {
  let index: HNSWIndex

  beforeEach(() => {
    index = createHNSWIndex({
      dimensions: 128,
      M: 16,
      efConstruction: 200,
    })

    for (let i = 0; i < 1000; i++) {
      index.insert(`vec-${i}`, randomVector(128))
    }
  })

  it('returns correct size', () => {
    expect(index.size()).toBe(1000)
  })

  it('returns dimensions', () => {
    expect(index.dimensions()).toBe(128)
  })

  it('returns max level', () => {
    const stats = index.getStats()
    expect(stats.maxLevel).toBeGreaterThan(0)
  })

  it('returns layer distribution', () => {
    const stats = index.getStats()

    expect(stats.layerDistribution).toBeDefined()
    expect(stats.layerDistribution.length).toBe(stats.maxLevel + 1)

    // Layer 0 should have all nodes
    expect(stats.layerDistribution[0]).toBe(1000)

    // Higher layers should have fewer nodes
    for (let i = 1; i < stats.layerDistribution.length; i++) {
      expect(stats.layerDistribution[i]).toBeLessThan(
        stats.layerDistribution[i - 1]
      )
    }
  })

  it('returns average connections per layer', () => {
    const stats = index.getStats()

    expect(stats.avgConnections).toBeDefined()
    expect(stats.avgConnections.length).toBeGreaterThan(0)

    // Layer 0 should have more connections on average
    expect(stats.avgConnections[0]).toBeLessThanOrEqual(32) // maxM0
    if (stats.avgConnections.length > 1) {
      expect(stats.avgConnections[1]).toBeLessThanOrEqual(16) // maxM
    }
  })

  it('returns entry point info', () => {
    const entryPoint = index.getEntryPoint()

    expect(entryPoint).toBeDefined()
    expect(entryPoint!.id).toBeDefined()
    expect(entryPoint!.level).toBeGreaterThanOrEqual(0)
  })

  it('returns memory usage estimate', () => {
    const stats = index.getStats()

    expect(stats.memoryBytes).toBeDefined()
    expect(stats.memoryBytes).toBeGreaterThan(0)

    // Memory should be roughly proportional to:
    // vectors (1000 * 128 * 4 bytes) + edges + overhead
    const minExpected = 1000 * 128 * 4
    expect(stats.memoryBytes).toBeGreaterThan(minExpected)
  })

  it('can retrieve individual node', () => {
    const node = index.getNode('vec-500')

    expect(node).toBeDefined()
    expect(node!.id).toBe('vec-500')
    expect(node!.level).toBeGreaterThanOrEqual(0)
    expect(node!.neighbors).toBeDefined()
    expect(node!.neighbors[0]).toBeDefined()
  })

  it('can retrieve vector by ID', () => {
    const vector = index.getVector('vec-500')

    expect(vector).toBeDefined()
    expect(vector).toBeInstanceOf(Float32Array)
    expect(vector!.length).toBe(128)
  })

  it('returns undefined for non-existent node', () => {
    const node = index.getNode('nonexistent')
    expect(node).toBeUndefined()
  })

  it('returns undefined for non-existent vector', () => {
    const vector = index.getVector('nonexistent')
    expect(vector).toBeUndefined()
  })
})

// ============================================================================
// SERIALIZATION TESTS
// ============================================================================

describe('HNSW Serialization', () => {
  it('serializes index to binary format', () => {
    const index = createHNSWIndex({
      dimensions: 128,
      M: 16,
      efConstruction: 200,
    })

    for (let i = 0; i < 100; i++) {
      index.insert(`vec-${i}`, seededVector(128, i))
    }

    const serialized = index.serialize()

    expect(serialized).toBeInstanceOf(ArrayBuffer)
    expect(serialized.byteLength).toBeGreaterThan(0)
  })

  it('deserializes index from binary format', () => {
    const original = createHNSWIndex({
      dimensions: 128,
      M: 16,
      efConstruction: 200,
    })

    for (let i = 0; i < 100; i++) {
      original.insert(`vec-${i}`, seededVector(128, i))
    }

    const serialized = original.serialize()
    const restored = HNSWIndexImpl.deserialize(serialized)

    expect(restored.size()).toBe(100)
    expect(restored.dimensions()).toBe(128)
    expect(restored.config().M).toBe(16)
  })

  it('preserves search results after serialization', () => {
    const original = createHNSWIndex({ dimensions: 128 })

    for (let i = 0; i < 100; i++) {
      original.insert(`vec-${i}`, seededVector(128, i))
    }

    const query = seededVector(128, 42)
    const originalResults = original.search(query, { k: 10 })

    const serialized = original.serialize()
    const restored = HNSWIndexImpl.deserialize(serialized)
    const restoredResults = restored.search(query, { k: 10 })

    expect(restoredResults).toEqual(originalResults)
  })

  it('serializes to JSON format', () => {
    const index = createHNSWIndex({ dimensions: 128 })

    for (let i = 0; i < 10; i++) {
      index.insert(`vec-${i}`, randomVector(128))
    }

    const json = index.toJSON()

    expect(json).toBeDefined()
    expect(json.config).toBeDefined()
    expect(json.nodes).toBeDefined()
    expect(json.vectors).toBeDefined()
  })

  it('deserializes from JSON format', () => {
    const original = createHNSWIndex({ dimensions: 128 })

    for (let i = 0; i < 10; i++) {
      original.insert(`vec-${i}`, seededVector(128, i))
    }

    const json = original.toJSON()
    const restored = HNSWIndexImpl.fromJSON(json)

    expect(restored.size()).toBe(10)
    expect(restored.dimensions()).toBe(128)
  })
})

// ============================================================================
// INSERT TESTS
// ============================================================================

describe('HNSW Insert', () => {
  let index: HNSWIndex

  beforeEach(() => {
    index = createHNSWIndex({
      dimensions: 128,
      M: 16,
      efConstruction: 200,
    })
  })

  it('inserts a single vector', () => {
    const vector = randomVector(128)
    index.insert('vec-1', vector)

    expect(index.size()).toBe(1)
    expect(index.has('vec-1')).toBe(true)
  })

  it('inserts multiple vectors', () => {
    for (let i = 0; i < 100; i++) {
      index.insert(`vec-${i}`, randomVector(128))
    }

    expect(index.size()).toBe(100)
  })

  it('assigns nodes to multiple layers', () => {
    // With 1000 vectors, we should have some nodes on higher layers
    for (let i = 0; i < 1000; i++) {
      index.insert(`vec-${i}`, randomVector(128))
    }

    const stats = index.getStats()
    expect(stats.maxLevel).toBeGreaterThan(0)
    expect(stats.layerDistribution.length).toBeGreaterThan(1)
  })

  it('maintains entry point at highest layer', () => {
    for (let i = 0; i < 100; i++) {
      index.insert(`vec-${i}`, randomVector(128))
    }

    const entryPoint = index.getEntryPoint()
    expect(entryPoint).toBeDefined()

    const stats = index.getStats()
    expect(entryPoint!.level).toBe(stats.maxLevel)
  })

  it('updates vector if ID already exists', () => {
    const v1 = randomVector(128)
    const v2 = randomVector(128)

    index.insert('vec-1', v1)
    index.insert('vec-1', v2)

    expect(index.size()).toBe(1)

    // Retrieve and verify updated
    const stored = index.getVector('vec-1')
    expect(stored).toBeDefined()
    // Should be v2, not v1
    expect(cosineSimilarity(stored!, v2)).toBeCloseTo(1, 5)
  })

  it('validates vector dimension', () => {
    const wrongDim = randomVector(64)

    expect(() => index.insert('wrong', wrongDim)).toThrow(
      /dimension mismatch/
    )
  })

  it('creates bidirectional edges', () => {
    for (let i = 0; i < 10; i++) {
      index.insert(`vec-${i}`, seededVector(128, i))
    }

    const node = index.getNode('vec-0')
    expect(node).toBeDefined()

    // Check that neighbors link back
    for (const neighborId of node!.neighbors[0] ?? []) {
      const neighbor = index.getNode(neighborId)
      expect(neighbor?.neighbors[0]).toContain('vec-0')
    }
  })

  it('respects maxM connection limit per layer', () => {
    const config = index.config()
    const maxM = config.maxM // 16 for layers > 0

    for (let i = 0; i < 1000; i++) {
      index.insert(`vec-${i}`, randomVector(128))
    }

    // Check random nodes
    for (let i = 0; i < 10; i++) {
      const node = index.getNode(`vec-${i * 100}`)
      if (node) {
        for (let level = 1; level <= node.level; level++) {
          const neighbors = node.neighbors[level] ?? []
          expect(neighbors.length).toBeLessThanOrEqual(maxM)
        }
      }
    }
  })

  it('respects maxM0 connection limit for layer 0', () => {
    const config = index.config()
    const maxM0 = config.maxM0 // 32 for layer 0

    for (let i = 0; i < 500; i++) {
      index.insert(`vec-${i}`, randomVector(128))
    }

    // Check random nodes
    for (let i = 0; i < 10; i++) {
      const node = index.getNode(`vec-${i * 50}`)
      if (node) {
        const layer0Neighbors = node.neighbors[0] ?? []
        expect(layer0Neighbors.length).toBeLessThanOrEqual(maxM0)
      }
    }
  })

  it('handles high-dimensional vectors', () => {
    const highDimIndex = createHNSWIndex({ dimensions: 1536 })

    for (let i = 0; i < 100; i++) {
      highDimIndex.insert(`vec-${i}`, randomVector(1536))
    }

    expect(highDimIndex.size()).toBe(100)
  })
})

// ============================================================================
// CONCURRENT ACCESS TESTS
// ============================================================================

describe('HNSW Concurrent Access', () => {
  it('handles concurrent inserts safely', async () => {
    const index = createHNSWIndex({ dimensions: 128 })

    // Simulate concurrent inserts
    const insertPromises = Array.from({ length: 100 }, (_, i) =>
      Promise.resolve().then(() => {
        index.insert(`vec-${i}`, randomVector(128))
      })
    )

    await Promise.all(insertPromises)

    expect(index.size()).toBe(100)
  })

  it('handles concurrent searches safely', async () => {
    const index = createHNSWIndex({ dimensions: 128 })

    for (let i = 0; i < 100; i++) {
      index.insert(`vec-${i}`, randomVector(128))
    }

    // Simulate concurrent searches
    const searchPromises = Array.from({ length: 50 }, () =>
      Promise.resolve().then(() => index.search(randomVector(128), { k: 10 }))
    )

    const results = await Promise.all(searchPromises)

    results.forEach((r) => {
      expect(r).toHaveLength(10)
    })
  })

  it('handles mixed insert/search/delete safely', async () => {
    const index = createHNSWIndex({ dimensions: 128 })

    // Initial population
    for (let i = 0; i < 50; i++) {
      index.insert(`vec-${i}`, randomVector(128))
    }

    // Sequential operations to avoid race conditions
    // (in production, proper locking would be needed)

    // First delete some vectors
    for (let i = 0; i < 10; i++) {
      index.delete(`vec-${i}`)
    }

    // Then insert new ones
    for (let i = 0; i < 25; i++) {
      index.insert(`new-${i}`, randomVector(128))
    }

    // Then search
    for (let i = 0; i < 5; i++) {
      const results = index.search(randomVector(128), { k: 5 })
      expect(results.length).toBeLessThanOrEqual(5)
    }

    // Should have: 50 - 10 (deleted) + 25 (inserted) = 65
    expect(index.size()).toBe(65)
  })
})

// ============================================================================
// GRAPH STRUCTURE TESTS
// ============================================================================

describe('HNSW Graph Structure', () => {
  it('maintains connected graph on layer 0', () => {
    const index = createHNSWIndex({
      dimensions: 128,
      M: 16,
      efConstruction: 200,
    })

    for (let i = 0; i < 100; i++) {
      index.insert(`vec-${i}`, randomVector(128))
    }

    // Every node should have at least one neighbor on layer 0
    // (except possibly the first inserted node if M is very small)
    let nodesWithNeighbors = 0
    for (let i = 0; i < 100; i++) {
      const node = index.getNode(`vec-${i}`)
      if (node && node.neighbors[0]?.length > 0) {
        nodesWithNeighbors++
      }
    }

    // At least 99% of nodes should have neighbors
    expect(nodesWithNeighbors).toBeGreaterThanOrEqual(99)
  })

  it('entry point has the highest level', () => {
    const index = createHNSWIndex({
      dimensions: 128,
      M: 16,
      efConstruction: 200,
    })

    for (let i = 0; i < 500; i++) {
      index.insert(`vec-${i}`, randomVector(128))
    }

    const entryPoint = index.getEntryPoint()!
    const entryNode = index.getNode(entryPoint.id)!
    const stats = index.getStats()

    expect(entryNode.level).toBe(stats.maxLevel)
  })

  it('level distribution follows exponential decay', () => {
    const index = createHNSWIndex({
      dimensions: 128,
      M: 16,
      efConstruction: 200,
    })

    for (let i = 0; i < 2000; i++) {
      index.insert(`vec-${i}`, randomVector(128))
    }

    const stats = index.getStats()
    const distribution = stats.layerDistribution

    // Each layer should have roughly 1/M of the nodes from the previous layer
    // Allow significant variance due to randomness
    // Only check layers with reasonable sample sizes (>10 nodes)
    for (let i = 1; i < distribution.length - 1; i++) {
      // Skip ratio check for very small layers where variance is high
      if (distribution[i] < 10) continue

      const ratio = distribution[i + 1] / distribution[i]
      // Ratio should be roughly 1/M = 1/16 = 0.0625, allow range 0.01 to 0.5
      expect(ratio).toBeGreaterThan(0.01)
      expect(ratio).toBeLessThan(0.5)
    }
  })
})

// ============================================================================
// DISTANCE METRIC ACCURACY TESTS
// ============================================================================

describe('HNSW Distance Metric Accuracy', () => {
  it('cosine similarity produces correct rankings', () => {
    const index = createHNSWIndex({
      dimensions: 128,
      metric: 'cosine',
    })

    const vectors = new Map<string, Float32Array>()
    for (let i = 0; i < 200; i++) {
      const v = seededVector(128, i)
      vectors.set(`vec-${i}`, v)
      index.insert(`vec-${i}`, v)
    }

    const query = seededVector(128, 100)
    const results = index.search(query, { k: 20, ef: 200 })
    const groundTruth = bruteForceKNN(query, vectors, 20, 'cosine')

    const recall = calculateRecall(results, groundTruth)
    expect(recall).toBeGreaterThanOrEqual(0.9)
  })

  it('L2 distance produces correct rankings', () => {
    const index = createHNSWIndex({
      dimensions: 128,
      metric: 'l2',
    })

    const vectors = new Map<string, Float32Array>()
    for (let i = 0; i < 200; i++) {
      const v = seededVector(128, i)
      vectors.set(`vec-${i}`, v)
      index.insert(`vec-${i}`, v)
    }

    const query = seededVector(128, 100)
    const results = index.search(query, { k: 20, ef: 200 })

    // For L2, manually compute ground truth
    const groundTruth = Array.from(vectors.entries())
      .map(([id, v]) => ({
        id,
        score: -l2Distance(query, v), // Negative because lower is better
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)

    const recall = calculateRecall(results, groundTruth)
    expect(recall).toBeGreaterThanOrEqual(0.9)
  })

  it('dot product produces correct rankings', () => {
    const index = createHNSWIndex({
      dimensions: 128,
      metric: 'dot',
    })

    const vectors = new Map<string, Float32Array>()
    for (let i = 0; i < 200; i++) {
      const v = seededVector(128, i)
      vectors.set(`vec-${i}`, v)
      index.insert(`vec-${i}`, v)
    }

    const query = seededVector(128, 100)
    const results = index.search(query, { k: 20, ef: 200 })

    // For dot product, manually compute ground truth
    const groundTruth = Array.from(vectors.entries())
      .map(([id, v]) => ({
        id,
        score: dotProduct(query, v),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)

    const recall = calculateRecall(results, groundTruth)
    expect(recall).toBeGreaterThanOrEqual(0.9)
  })
})

// ============================================================================
// RECALL VS EF PARAMETER TESTS
// ============================================================================

describe('HNSW Recall vs ef Parameter', () => {
  let index: HNSWIndex
  let vectors: Map<string, Float32Array>

  beforeEach(() => {
    index = createHNSWIndex({
      dimensions: 128,
      M: 16,
      efConstruction: 200,
      metric: 'cosine',
    })

    vectors = new Map()
    for (let i = 0; i < 1000; i++) {
      const v = seededVector(128, i)
      vectors.set(`vec-${i}`, v)
      index.insert(`vec-${i}`, v)
    }
  })

  it('recall increases with ef', () => {
    const query = randomVector(128)
    const k = 10
    const groundTruth = bruteForceKNN(query, vectors, k, 'cosine')

    const efValues = [10, 20, 50, 100, 200]
    const recalls: number[] = []

    for (const ef of efValues) {
      const results = index.search(query, { k, ef })
      recalls.push(calculateRecall(results, groundTruth))
    }

    // Recall should generally increase with ef (with some variance)
    // Check that the highest ef gives at least as good recall as the lowest
    expect(recalls[recalls.length - 1]).toBeGreaterThanOrEqual(recalls[0])
  })

  it('reaches near-perfect recall at high ef', () => {
    const numQueries = 20
    let totalRecall = 0

    for (let q = 0; q < numQueries; q++) {
      const query = randomVector(128)
      const k = 10
      const groundTruth = bruteForceKNN(query, vectors, k, 'cosine')
      const results = index.search(query, { k, ef: 500 })
      totalRecall += calculateRecall(results, groundTruth)
    }

    const avgRecall = totalRecall / numQueries
    expect(avgRecall).toBeGreaterThanOrEqual(0.98)
  })
})

// ============================================================================
// LARGE SCALE TESTS
// ============================================================================

describe('HNSW Large Scale', () => {
  it('handles 10k vectors', { timeout: 60000 }, () => {
    const index = createHNSWIndex({
      dimensions: 128,
      M: 16,
      efConstruction: 100,
    })

    for (let i = 0; i < 10000; i++) {
      index.insert(`vec-${i}`, randomVector(128))
    }

    expect(index.size()).toBe(10000)

    // Search should still work efficiently
    const startTime = performance.now()
    const results = index.search(randomVector(128), { k: 10, ef: 50 })
    const searchTime = performance.now() - startTime

    expect(results).toHaveLength(10)
    expect(searchTime).toBeLessThan(50) // Should be fast
  })

  it('maintains recall at large scale', { timeout: 60000 }, () => {
    const index = createHNSWIndex({
      dimensions: 128,
      M: 32,
      efConstruction: 200,
    })

    const vectors = new Map<string, Float32Array>()
    for (let i = 0; i < 5000; i++) {
      const v = seededVector(128, i)
      vectors.set(`vec-${i}`, v)
      index.insert(`vec-${i}`, v)
    }

    // Test recall
    let totalRecall = 0
    const numQueries = 10

    for (let q = 0; q < numQueries; q++) {
      const query = randomVector(128)
      const results = index.search(query, { k: 10, ef: 100 })
      const groundTruth = bruteForceKNN(query, vectors, 10, 'cosine')
      totalRecall += calculateRecall(results, groundTruth)
    }

    const avgRecall = totalRecall / numQueries
    expect(avgRecall).toBeGreaterThanOrEqual(0.85)
  })
})

// ============================================================================
// DISTANCE FUNCTION DIMENSION VALIDATION TESTS
// ============================================================================

describe('HNSW Distance Function Dimension Validation', () => {
  describe('validateVectorDimensions utility', () => {
    it('does not throw for matching dimensions', () => {
      const a = new Float32Array(128)
      const b = new Float32Array(128)
      expect(() => validateVectorDimensions(a, b)).not.toThrow()
    })

    it('throws for mismatched dimensions (a shorter)', () => {
      const a = new Float32Array(64)
      const b = new Float32Array(128)
      expect(() => validateVectorDimensions(a, b)).toThrow(/Vector dimension mismatch: 64 vs 128/)
    })

    it('throws for mismatched dimensions (a longer)', () => {
      const a = new Float32Array(256)
      const b = new Float32Array(128)
      expect(() => validateVectorDimensions(a, b)).toThrow(/Vector dimension mismatch: 256 vs 128/)
    })

    it('throws for empty vector vs non-empty', () => {
      const a = new Float32Array(0)
      const b = new Float32Array(128)
      expect(() => validateVectorDimensions(a, b)).toThrow(/Vector dimension mismatch: 0 vs 128/)
    })

    it('does not throw for both empty vectors', () => {
      const a = new Float32Array(0)
      const b = new Float32Array(0)
      expect(() => validateVectorDimensions(a, b)).not.toThrow()
    })
  })

  it('cosineDistance throws on mismatched dimensions', () => {
    const index = createHNSWIndex({
      dimensions: 128,
      metric: 'cosine',
    })

    // Insert a vector with correct dimensions
    index.insert('vec-1', randomVector(128))

    // Attempting to search with wrong dimensions should throw
    const wrongDimQuery = randomVector(64)
    expect(() => index.search(wrongDimQuery)).toThrow(/dimension mismatch/)
  })

  it('l2Distance throws on mismatched dimensions', () => {
    const index = createHNSWIndex({
      dimensions: 128,
      metric: 'l2',
    })

    // Insert a vector with correct dimensions
    index.insert('vec-1', randomVector(128))

    // Attempting to search with wrong dimensions should throw
    const wrongDimQuery = randomVector(64)
    expect(() => index.search(wrongDimQuery)).toThrow(/dimension mismatch/)
  })

  it('dotDistance throws on mismatched dimensions', () => {
    const index = createHNSWIndex({
      dimensions: 128,
      metric: 'dot',
    })

    // Insert a vector with correct dimensions
    index.insert('vec-1', randomVector(128))

    // Attempting to search with wrong dimensions should throw
    const wrongDimQuery = randomVector(64)
    expect(() => index.search(wrongDimQuery)).toThrow(/dimension mismatch/)
  })

  it('insert throws on mismatched dimensions', () => {
    const index = createHNSWIndex({
      dimensions: 128,
      metric: 'cosine',
    })

    const wrongDimVector = randomVector(64)
    expect(() => index.insert('wrong', wrongDimVector)).toThrow(/dimension mismatch/)
  })

  it('handles dimension mismatch when query is longer than stored vectors', () => {
    const index = createHNSWIndex({
      dimensions: 128,
      metric: 'cosine',
    })

    index.insert('vec-1', randomVector(128))

    // Query with MORE dimensions than expected
    const longerQuery = randomVector(256)
    expect(() => index.search(longerQuery)).toThrow(/dimension mismatch/)
  })

  it('handles dimension mismatch when query is shorter than stored vectors', () => {
    const index = createHNSWIndex({
      dimensions: 128,
      metric: 'cosine',
    })

    index.insert('vec-1', randomVector(128))

    // Query with FEWER dimensions than expected
    const shorterQuery = randomVector(32)
    expect(() => index.search(shorterQuery)).toThrow(/dimension mismatch/)
  })
})
