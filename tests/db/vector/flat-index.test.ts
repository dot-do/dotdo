/**
 * Flat Index Tests (RED Phase)
 *
 * Comprehensive tests for Flat (brute-force) vector backend.
 * The Flat index provides 100% exact recall as the baseline for accuracy.
 *
 * Tests cover:
 * - Exact KNN search (baseline correctness)
 * - All distance metrics: cosine, euclidean, dot product, manhattan
 * - Large dataset performance baseline (10k, 100k vectors)
 * - Memory efficiency with SQLite backing
 * - Matryoshka dimension truncation (1536 -> 256 -> 64)
 *
 * These tests are expected to FAIL until FlatIndex is implemented.
 *
 * @see db/vector/engines/flat.ts (to be created)
 * @module tests/db/vector/flat-index.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ============================================================================
// MODULE IMPORTS (will fail until implementation exists)
// ============================================================================

let FlatIndex: any
let DistanceMetric: any

beforeEach(async () => {
  try {
    const module = await import('../../../db/vector/engines/flat')
    FlatIndex = module.FlatIndex
    DistanceMetric = module.DistanceMetric
  } catch {
    FlatIndex = undefined
    DistanceMetric = undefined
  }
})

// ============================================================================
// TEST UTILITIES
// ============================================================================

function assertModuleLoaded(name: string, mod: any): asserts mod {
  if (!mod) {
    throw new Error(
      `FlatIndex module not implemented. Expected '${name}' from 'db/vector/engines/flat'. ` +
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

  let norm = 0
  for (let i = 0; i < dims; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const u1 = Math.max(0.001, s / 0x7fffffff) // Ensure u1 > 0 for stable log
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const u2 = s / 0x7fffffff
    let z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
    z = Number.isFinite(z) ? z : 0.001 // Handle any edge cases

    // Apply Matryoshka-like decay: early dimensions have more weight/variance
    // This simulates real Matryoshka embeddings where first N dims capture most info
    // Strong decay ensures truncated searches achieve high recall
    const decay = Math.exp(-i / 64) // Very strong decay - 64 dims capture most info
    vec[i] = z * (0.01 + 0.99 * decay) // Scale by decay factor

    norm += vec[i] * vec[i]
  }

  norm = Math.sqrt(norm)
  if (norm === 0) norm = 1 // Prevent division by zero
  for (let i = 0; i < dims; i++) {
    vec[i] /= norm
  }

  return vec
}

/**
 * Generate a random vector (not normalized)
 */
function randomVector(dims: number, seed?: number): Float32Array {
  const vec = new Float32Array(dims)
  let s = seed ?? Math.floor(Math.random() * 2147483647)

  for (let i = 0; i < dims; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    vec[i] = (s / 0x7fffffff) * 2 - 1 // Range [-1, 1]
  }

  return vec
}

/**
 * Compute cosine similarity between two vectors
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const minLen = Math.min(a.length, b.length)
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < minLen; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * Compute euclidean distance between two vectors
 */
function euclideanDistance(a: Float32Array, b: Float32Array): number {
  const minLen = Math.min(a.length, b.length)
  let sum = 0
  for (let i = 0; i < minLen; i++) {
    const diff = a[i] - b[i]
    sum += diff * diff
  }
  return Math.sqrt(sum)
}

/**
 * Compute dot product between two vectors
 */
function dotProduct(a: Float32Array, b: Float32Array): number {
  const minLen = Math.min(a.length, b.length)
  let dot = 0
  for (let i = 0; i < minLen; i++) {
    dot += a[i] * b[i]
  }
  return dot
}

/**
 * Compute manhattan distance between two vectors
 */
function manhattanDistance(a: Float32Array, b: Float32Array): number {
  const minLen = Math.min(a.length, b.length)
  let sum = 0
  for (let i = 0; i < minLen; i++) {
    sum += Math.abs(a[i] - b[i])
  }
  return sum
}

/**
 * Truncate embedding to target dimension (Matryoshka)
 */
function truncateEmbedding(embedding: Float32Array, targetDim: number): Float32Array {
  if (targetDim >= embedding.length) return embedding
  return embedding.slice(0, targetDim)
}

/**
 * Create a mock SQLite-like database
 */
function createMockDb() {
  return {
    exec: vi.fn(),
    prepare: vi.fn(() => ({
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn(() => []),
    })),
  }
}

// ============================================================================
// TESTS: Basic FlatIndex Operations
// ============================================================================

describe('FlatIndex - Basic Operations', () => {
  it('should export FlatIndex class', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)
    expect(typeof FlatIndex).toBe('function')
  })

  it('should export DistanceMetric enum', async () => {
    assertModuleLoaded('DistanceMetric', DistanceMetric)
    expect(DistanceMetric.Cosine).toBeDefined()
    expect(DistanceMetric.Euclidean).toBeDefined()
    expect(DistanceMetric.DotProduct).toBeDefined()
    expect(DistanceMetric.Manhattan).toBeDefined()
  })

  it('should create FlatIndex with default options', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({ dimension: 1536 })

    expect(index.dimension).toBe(1536)
    expect(index.metric).toBe(DistanceMetric.Cosine) // Default metric
    expect(index.size).toBe(0)
  })

  it('should add a single vector', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({ dimension: 1536 })
    const vector = randomNormalizedVector(1536, 42)

    await index.add('vec_1', vector)

    expect(index.size).toBe(1)
    expect(index.has('vec_1')).toBe(true)
  })

  it('should add multiple vectors', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({ dimension: 1536 })

    for (let i = 0; i < 100; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(1536, i))
    }

    expect(index.size).toBe(100)
  })

  it('should remove a vector', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({ dimension: 1536 })

    await index.add('vec_1', randomNormalizedVector(1536, 1))
    await index.add('vec_2', randomNormalizedVector(1536, 2))

    expect(index.size).toBe(2)

    await index.remove('vec_1')

    expect(index.size).toBe(1)
    expect(index.has('vec_1')).toBe(false)
    expect(index.has('vec_2')).toBe(true)
  })

  it('should get a vector by id', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({ dimension: 1536 })
    const vector = randomNormalizedVector(1536, 42)

    await index.add('vec_1', vector)

    const retrieved = await index.get('vec_1')

    expect(retrieved).toBeInstanceOf(Float32Array)
    expect(retrieved.length).toBe(1536)
    // Vectors should be identical
    for (let i = 0; i < 1536; i++) {
      expect(retrieved[i]).toBeCloseTo(vector[i], 5)
    }
  })

  it('should return null for non-existent vector', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({ dimension: 1536 })

    const result = await index.get('non_existent')

    expect(result).toBeNull()
  })

  it('should update an existing vector', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({ dimension: 1536 })

    const vector1 = randomNormalizedVector(1536, 1)
    const vector2 = randomNormalizedVector(1536, 2)

    await index.add('vec_1', vector1)
    await index.update('vec_1', vector2)

    const retrieved = await index.get('vec_1')

    // Should have the updated vector
    for (let i = 0; i < 1536; i++) {
      expect(retrieved[i]).toBeCloseTo(vector2[i], 5)
    }
  })

  it('should clear all vectors', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({ dimension: 1536 })

    for (let i = 0; i < 10; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(1536, i))
    }

    expect(index.size).toBe(10)

    await index.clear()

    expect(index.size).toBe(0)
  })

  it('should validate dimension on add', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({ dimension: 1536 })
    const wrongDimVector = randomNormalizedVector(768, 42)

    await expect(index.add('vec_1', wrongDimVector)).rejects.toThrow(
      /dimension.*mismatch|expected.*1536|invalid.*dimension/i
    )
  })
})

// ============================================================================
// TESTS: Exact KNN Search (Baseline Correctness)
// ============================================================================

describe('FlatIndex - Exact KNN Search', () => {
  it('should find exact nearest neighbors', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({ dimension: 1536, metric: DistanceMetric.Cosine })

    // Insert 100 vectors
    for (let i = 0; i < 100; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(1536, i * 100))
    }

    // Search with vector identical to vec_50
    const query = randomNormalizedVector(1536, 5000) // Same seed as vec_50

    const results = await index.search(query, 5)

    expect(results).toHaveLength(5)
    expect(results[0].id).toBe('vec_50')
    expect(results[0].similarity).toBeCloseTo(1.0, 4)
  })

  it('should achieve 100% recall (brute force guarantee)', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({ dimension: 1536, metric: DistanceMetric.Cosine })

    // Insert vectors with known similarities
    const vectors: { id: string; embedding: Float32Array }[] = []
    for (let i = 0; i < 100; i++) {
      const embedding = randomNormalizedVector(1536, i * 1000)
      vectors.push({ id: `vec_${i}`, embedding })
      await index.add(`vec_${i}`, embedding)
    }

    // Test 50 queries
    let correctRecalls = 0
    for (let q = 0; q < 50; q++) {
      const query = randomNormalizedVector(1536, q * 2000)

      // Ground truth: compute actual similarities and sort
      const groundTruth = vectors
        .map((v) => ({
          id: v.id,
          similarity: cosineSimilarity(query, v.embedding),
        }))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 10)
        .map((v) => v.id)

      // Search results
      const results = await index.search(query, 10)
      const resultIds = results.map((r: any) => r.id)

      // Count how many ground truth items are in results
      const hits = groundTruth.filter((id) => resultIds.includes(id)).length

      if (hits === 10) correctRecalls++
    }

    // Brute force should achieve 100% recall
    const recallRate = correctRecalls / 50
    expect(recallRate).toBe(1.0) // Exact 100% recall
  })

  it('should return results sorted by similarity (descending)', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({ dimension: 1536, metric: DistanceMetric.Cosine })

    for (let i = 0; i < 50; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(1536, i))
    }

    const results = await index.search(randomNormalizedVector(1536, 25), 20)

    // Check ordering
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].similarity).toBeGreaterThanOrEqual(results[i + 1].similarity)
    }
  })

  it('should respect limit parameter', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({ dimension: 1536 })

    for (let i = 0; i < 100; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(1536, i))
    }

    const results5 = await index.search(randomNormalizedVector(1536, 42), 5)
    const results10 = await index.search(randomNormalizedVector(1536, 42), 10)
    const results1 = await index.search(randomNormalizedVector(1536, 42), 1)

    expect(results5).toHaveLength(5)
    expect(results10).toHaveLength(10)
    expect(results1).toHaveLength(1)
  })

  it('should return empty array when index is empty', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({ dimension: 1536 })

    const results = await index.search(randomNormalizedVector(1536, 42), 10)

    expect(results).toEqual([])
  })

  it('should include both similarity and distance in results', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({ dimension: 1536, metric: DistanceMetric.Cosine })

    await index.add('vec_1', randomNormalizedVector(1536, 1))

    const results = await index.search(randomNormalizedVector(1536, 1), 1)

    expect(results[0]).toHaveProperty('id')
    expect(results[0]).toHaveProperty('similarity')
    expect(results[0]).toHaveProperty('distance')
    // For cosine: distance = 1 - similarity
    expect(results[0].distance).toBeCloseTo(1 - results[0].similarity, 5)
  })

  it('should handle duplicate id gracefully (upsert behavior)', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({ dimension: 1536 })

    const vec1 = randomNormalizedVector(1536, 1)
    const vec2 = randomNormalizedVector(1536, 2)

    await index.add('vec_1', vec1)
    await index.add('vec_1', vec2) // Same id, different vector

    expect(index.size).toBe(1) // Should not increase size

    const retrieved = await index.get('vec_1')
    // Should have the latest vector
    expect(cosineSimilarity(retrieved, vec2)).toBeCloseTo(1.0, 5)
  })
})

// ============================================================================
// TESTS: Distance Metrics
// ============================================================================

describe('FlatIndex - Distance Metrics: Cosine', () => {
  it('should compute cosine similarity correctly', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({ dimension: 4, metric: DistanceMetric.Cosine })

    // Known vectors for testing
    const vecA = new Float32Array([1, 0, 0, 0])
    const vecB = new Float32Array([1, 0, 0, 0]) // Same direction
    const vecC = new Float32Array([0, 1, 0, 0]) // Orthogonal
    const vecD = new Float32Array([-1, 0, 0, 0]) // Opposite

    await index.add('a', vecA)
    await index.add('b', vecB)
    await index.add('c', vecC)
    await index.add('d', vecD)

    const query = new Float32Array([1, 0, 0, 0])
    const results = await index.search(query, 4)

    // Same direction: similarity = 1
    expect(results.find((r: any) => r.id === 'a')?.similarity).toBeCloseTo(1.0, 5)
    expect(results.find((r: any) => r.id === 'b')?.similarity).toBeCloseTo(1.0, 5)

    // Orthogonal: similarity = 0
    expect(results.find((r: any) => r.id === 'c')?.similarity).toBeCloseTo(0.0, 5)

    // Opposite: similarity = -1
    expect(results.find((r: any) => r.id === 'd')?.similarity).toBeCloseTo(-1.0, 5)
  })

  it('should rank by cosine similarity correctly', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({ dimension: 1536, metric: DistanceMetric.Cosine })

    // Create vectors with known relative similarities
    const base = randomNormalizedVector(1536, 1)

    // Create vectors at different angles from base
    for (let i = 0; i < 20; i++) {
      const noise = randomVector(1536, i + 100)
      const vec = new Float32Array(1536)
      const mixFactor = i / 20 // 0 = identical, 1 = mostly noise
      for (let j = 0; j < 1536; j++) {
        vec[j] = base[j] * (1 - mixFactor) + noise[j] * mixFactor
      }
      // Normalize
      let norm = 0
      for (let j = 0; j < 1536; j++) norm += vec[j] * vec[j]
      norm = Math.sqrt(norm)
      for (let j = 0; j < 1536; j++) vec[j] /= norm

      await index.add(`vec_${i}`, vec)
    }

    const results = await index.search(base, 20)

    // Results should be sorted by similarity
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].similarity).toBeGreaterThanOrEqual(results[i + 1].similarity)
    }
  })
})

describe('FlatIndex - Distance Metrics: Euclidean', () => {
  it('should compute euclidean distance correctly', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({ dimension: 3, metric: DistanceMetric.Euclidean })

    // Known vectors for testing
    const origin = new Float32Array([0, 0, 0])
    const unit = new Float32Array([1, 0, 0])
    const diagonal = new Float32Array([1, 1, 1])

    await index.add('origin', origin)
    await index.add('unit', unit)
    await index.add('diagonal', diagonal)

    // Search from origin
    const query = new Float32Array([0, 0, 0])
    const results = await index.search(query, 3)

    // Origin to origin = 0
    expect(results.find((r: any) => r.id === 'origin')?.distance).toBeCloseTo(0, 5)

    // Origin to unit = 1
    expect(results.find((r: any) => r.id === 'unit')?.distance).toBeCloseTo(1, 5)

    // Origin to diagonal = sqrt(3)
    expect(results.find((r: any) => r.id === 'diagonal')?.distance).toBeCloseTo(Math.sqrt(3), 5)
  })

  it('should rank by euclidean distance correctly (ascending)', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({ dimension: 1536, metric: DistanceMetric.Euclidean })

    const center = randomVector(1536, 42)

    for (let i = 0; i < 50; i++) {
      await index.add(`vec_${i}`, randomVector(1536, i))
    }

    const results = await index.search(center, 50)

    // For euclidean, smaller distance = more similar
    // Results should be sorted by distance ascending
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].distance).toBeLessThanOrEqual(results[i + 1].distance)
    }
  })

  it('should convert euclidean distance to similarity', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({ dimension: 3, metric: DistanceMetric.Euclidean })

    await index.add('near', new Float32Array([0.1, 0, 0]))
    await index.add('far', new Float32Array([10, 10, 10]))

    const results = await index.search(new Float32Array([0, 0, 0]), 2)

    // Near point should have higher similarity
    expect(results[0].id).toBe('near')
    expect(results[0].similarity).toBeGreaterThan(results[1].similarity)

    // Similarity formula: 1 / (1 + distance)
    expect(results[0].similarity).toBeCloseTo(1 / (1 + results[0].distance), 5)
  })
})

describe('FlatIndex - Distance Metrics: Dot Product', () => {
  it('should compute dot product correctly', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({ dimension: 4, metric: DistanceMetric.DotProduct })

    const vecA = new Float32Array([1, 2, 3, 4])
    const vecB = new Float32Array([1, 0, 0, 0])
    const vecC = new Float32Array([0, 0, 0, 1])

    await index.add('a', vecA)
    await index.add('b', vecB)
    await index.add('c', vecC)

    // Query with [1, 1, 1, 1]
    const query = new Float32Array([1, 1, 1, 1])
    const results = await index.search(query, 3)

    // dot([1,1,1,1], [1,2,3,4]) = 1+2+3+4 = 10
    expect(results.find((r: any) => r.id === 'a')?.similarity).toBeCloseTo(10, 5)

    // dot([1,1,1,1], [1,0,0,0]) = 1
    expect(results.find((r: any) => r.id === 'b')?.similarity).toBeCloseTo(1, 5)

    // dot([1,1,1,1], [0,0,0,1]) = 1
    expect(results.find((r: any) => r.id === 'c')?.similarity).toBeCloseTo(1, 5)
  })

  it('should rank by dot product correctly (descending)', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({ dimension: 1536, metric: DistanceMetric.DotProduct })

    for (let i = 0; i < 50; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(1536, i))
    }

    const query = randomNormalizedVector(1536, 25)
    const results = await index.search(query, 50)

    // Higher dot product = more similar
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].similarity).toBeGreaterThanOrEqual(results[i + 1].similarity)
    }
  })

  it('should handle negative dot products', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({ dimension: 4, metric: DistanceMetric.DotProduct })

    const positive = new Float32Array([1, 1, 1, 1])
    const negative = new Float32Array([-1, -1, -1, -1])

    await index.add('positive', positive)
    await index.add('negative', negative)

    const query = new Float32Array([1, 1, 1, 1])
    const results = await index.search(query, 2)

    expect(results[0].id).toBe('positive')
    expect(results[0].similarity).toBe(4)
    expect(results[1].id).toBe('negative')
    expect(results[1].similarity).toBe(-4)
  })
})

describe('FlatIndex - Distance Metrics: Manhattan', () => {
  it('should compute manhattan distance correctly', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({ dimension: 4, metric: DistanceMetric.Manhattan })

    const origin = new Float32Array([0, 0, 0, 0])
    const unit = new Float32Array([1, 0, 0, 0])
    const diagonal = new Float32Array([1, 1, 1, 1])

    await index.add('origin', origin)
    await index.add('unit', unit)
    await index.add('diagonal', diagonal)

    const query = new Float32Array([0, 0, 0, 0])
    const results = await index.search(query, 3)

    // Manhattan from origin to origin = 0
    expect(results.find((r: any) => r.id === 'origin')?.distance).toBeCloseTo(0, 5)

    // Manhattan from origin to unit = |1| = 1
    expect(results.find((r: any) => r.id === 'unit')?.distance).toBeCloseTo(1, 5)

    // Manhattan from origin to diagonal = |1|+|1|+|1|+|1| = 4
    expect(results.find((r: any) => r.id === 'diagonal')?.distance).toBeCloseTo(4, 5)
  })

  it('should rank by manhattan distance correctly (ascending)', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({ dimension: 1536, metric: DistanceMetric.Manhattan })

    for (let i = 0; i < 50; i++) {
      await index.add(`vec_${i}`, randomVector(1536, i))
    }

    const query = randomVector(1536, 25)
    const results = await index.search(query, 50)

    // Smaller manhattan distance = more similar
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].distance).toBeLessThanOrEqual(results[i + 1].distance)
    }
  })

  it('should handle high-dimensional manhattan distance', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({ dimension: 1536, metric: DistanceMetric.Manhattan })

    const vec1 = new Float32Array(1536).fill(0)
    const vec2 = new Float32Array(1536).fill(1)

    await index.add('zeros', vec1)
    await index.add('ones', vec2)

    const query = new Float32Array(1536).fill(0)
    const results = await index.search(query, 2)

    // zeros to zeros = 0
    expect(results[0].id).toBe('zeros')
    expect(results[0].distance).toBeCloseTo(0, 5)

    // zeros to ones = 1536 (each dimension contributes 1)
    expect(results[1].id).toBe('ones')
    expect(results[1].distance).toBeCloseTo(1536, 5)
  })
})

// ============================================================================
// TESTS: Large Dataset Performance Baseline
// ============================================================================

describe('FlatIndex - Large Dataset Performance (10k vectors)', () => {
  it('should handle 10k vectors', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({ dimension: 1536 })

    // Insert 10k vectors
    const startInsert = performance.now()
    for (let i = 0; i < 10000; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(1536, i))
    }
    const insertTime = performance.now() - startInsert

    expect(index.size).toBe(10000)

    // Insert should complete in reasonable time (< 30 seconds)
    expect(insertTime).toBeLessThan(30000)
  }, 60000) // 60s timeout

  it('should search 10k vectors with exact recall', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({ dimension: 1536, metric: DistanceMetric.Cosine })

    // Pre-populate with 10k vectors
    const vectors: { id: string; embedding: Float32Array }[] = []
    for (let i = 0; i < 10000; i++) {
      const embedding = randomNormalizedVector(1536, i * 100)
      vectors.push({ id: `vec_${i}`, embedding })
      await index.add(`vec_${i}`, embedding)
    }

    // Benchmark search time
    const query = randomNormalizedVector(1536, 5000) // Similar to vec_50
    const startSearch = performance.now()
    const results = await index.search(query, 10)
    const searchTime = performance.now() - startSearch

    // Verify exact match found
    expect(results[0].id).toBe('vec_50')
    expect(results[0].similarity).toBeCloseTo(1.0, 4)

    // Brute force on 10k should be < 500ms
    expect(searchTime).toBeLessThan(500)
  }, 60000)

  it('should report performance metrics for 10k search', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({ dimension: 1536 })

    for (let i = 0; i < 10000; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(1536, i))
    }

    const query = randomNormalizedVector(1536, 42)
    const result = await index.search(query, 10, { returnMetrics: true })

    expect(result.metrics).toBeDefined()
    expect(result.metrics.vectorsScanned).toBe(10000)
    expect(result.metrics.timeMs).toBeGreaterThan(0)
  }, 60000)
})

describe('FlatIndex - Large Dataset Performance (100k vectors)', () => {
  it('should handle 100k vectors', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({ dimension: 1536 })

    // Batch insert for speed
    const batchSize = 1000
    const startInsert = performance.now()

    for (let batch = 0; batch < 100; batch++) {
      const vectors: { id: string; vector: Float32Array }[] = []
      for (let i = 0; i < batchSize; i++) {
        const idx = batch * batchSize + i
        vectors.push({
          id: `vec_${idx}`,
          vector: randomNormalizedVector(1536, idx),
        })
      }
      await index.addBatch(vectors)
    }

    const insertTime = performance.now() - startInsert

    expect(index.size).toBe(100000)

    // Insert 100k should complete in reasonable time (< 5 minutes)
    expect(insertTime).toBeLessThan(300000)
  }, 600000) // 10 min timeout

  it('should search 100k vectors with acceptable latency', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({ dimension: 1536, metric: DistanceMetric.Cosine })

    // Pre-populate with 100k vectors
    for (let batch = 0; batch < 100; batch++) {
      const vectors: { id: string; vector: Float32Array }[] = []
      for (let i = 0; i < 1000; i++) {
        const idx = batch * 1000 + i
        vectors.push({
          id: `vec_${idx}`,
          vector: randomNormalizedVector(1536, idx),
        })
      }
      await index.addBatch(vectors)
    }

    // Benchmark search time (multiple queries for average)
    const searchTimes: number[] = []
    for (let q = 0; q < 10; q++) {
      const query = randomNormalizedVector(1536, q * 10000)
      const start = performance.now()
      await index.search(query, 10)
      searchTimes.push(performance.now() - start)
    }

    const avgSearchTime = searchTimes.reduce((a, b) => a + b, 0) / searchTimes.length

    // Brute force on 100k should be < 5 seconds
    expect(avgSearchTime).toBeLessThan(5000)
  }, 600000)

  it('should maintain 100% recall at 100k scale', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({ dimension: 1536, metric: DistanceMetric.Cosine })

    // Insert 100k vectors
    const allVectors: Map<string, Float32Array> = new Map()
    for (let batch = 0; batch < 100; batch++) {
      const vectors: { id: string; vector: Float32Array }[] = []
      for (let i = 0; i < 1000; i++) {
        const idx = batch * 1000 + i
        const embedding = randomNormalizedVector(1536, idx)
        allVectors.set(`vec_${idx}`, embedding)
        vectors.push({ id: `vec_${idx}`, vector: embedding })
      }
      await index.addBatch(vectors)
    }

    // Test recall on 10 queries
    let totalRecall = 0
    for (let q = 0; q < 10; q++) {
      const query = randomNormalizedVector(1536, q * 50000)

      // Compute ground truth
      const groundTruth = Array.from(allVectors.entries())
        .map(([id, vec]) => ({ id, similarity: cosineSimilarity(query, vec) }))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 10)
        .map((v) => v.id)

      const results = await index.search(query, 10)
      const resultIds = results.map((r: any) => r.id)

      const hits = groundTruth.filter((id) => resultIds.includes(id)).length
      totalRecall += hits / 10
    }

    const avgRecall = totalRecall / 10

    // Brute force must have 100% recall
    expect(avgRecall).toBe(1.0)
  }, 600000)
})

// ============================================================================
// TESTS: Memory Efficiency with SQLite Backing
// ============================================================================

describe('FlatIndex - Memory Efficiency with SQLite Backing', () => {
  it('should support SQLite-backed storage', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const db = createMockDb()
    const index = new FlatIndex({
      dimension: 1536,
      storage: 'sqlite',
      db,
    })

    await index.add('vec_1', randomNormalizedVector(1536, 1))

    expect(db.exec).toHaveBeenCalled()
  })

  it('should lazily load vectors from SQLite', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const db = createMockDb()
    const index = new FlatIndex({
      dimension: 1536,
      storage: 'sqlite',
      db,
      lazyLoad: true,
    })

    // Insert 1000 vectors
    for (let i = 0; i < 1000; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(1536, i))
    }

    // Memory usage should be minimal (vectors stored in SQLite, not memory)
    const memoryEstimate = index.getMemoryUsage()

    // With lazy loading, memory should be much less than full storage
    // Full storage: 1000 * 1536 * 4 bytes = ~6MB
    // Lazy: should only cache frequently accessed vectors
    expect(memoryEstimate.bytesInMemory).toBeLessThan(1000000) // < 1MB
  })

  it('should support streaming search for large datasets', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const db = createMockDb()
    const index = new FlatIndex({
      dimension: 1536,
      storage: 'sqlite',
      db,
    })

    // Insert 10k vectors
    for (let i = 0; i < 10000; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(1536, i))
    }

    const query = randomNormalizedVector(1536, 5000)

    // Streaming search should yield results incrementally
    const stream = index.searchStream(query, 10, { batchSize: 1000 })

    let resultCount = 0
    let batchCount = 0

    for await (const batch of stream) {
      batchCount++
      resultCount += batch.length

      // Each batch should have valid results
      for (const result of batch) {
        expect(result).toHaveProperty('id')
        expect(result).toHaveProperty('similarity')
      }
    }

    expect(resultCount).toBe(10)
    expect(batchCount).toBeGreaterThanOrEqual(1)
  })

  it('should persist vectors to SQLite and reload', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const db = createMockDb()

    // Create and populate index
    const index1 = new FlatIndex({
      dimension: 1536,
      storage: 'sqlite',
      db,
    })

    const testVector = randomNormalizedVector(1536, 42)
    await index1.add('vec_test', testVector)

    // Simulate reload from SQLite
    const index2 = new FlatIndex({
      dimension: 1536,
      storage: 'sqlite',
      db,
    })

    await index2.load()

    const retrieved = await index2.get('vec_test')

    expect(retrieved).not.toBeNull()
    expect(cosineSimilarity(retrieved, testVector)).toBeCloseTo(1.0, 5)
  })

  it('should report memory usage statistics', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({ dimension: 1536 })

    for (let i = 0; i < 100; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(1536, i))
    }

    const memoryUsage = index.getMemoryUsage()

    expect(memoryUsage).toHaveProperty('vectorCount')
    expect(memoryUsage).toHaveProperty('bytesInMemory')
    expect(memoryUsage).toHaveProperty('bytesPerVector')

    expect(memoryUsage.vectorCount).toBe(100)
    // 1536 dims * 4 bytes = 6144 bytes per vector
    expect(memoryUsage.bytesPerVector).toBeCloseTo(6144, -1)
    expect(memoryUsage.bytesInMemory).toBeGreaterThan(600000) // 100 * 6144 minimum
  })
})

// ============================================================================
// TESTS: Matryoshka Dimension Truncation
// ============================================================================

describe('FlatIndex - Matryoshka Dimension Truncation', () => {
  it('should support search with truncated dimensions', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({
      dimension: 1536,
      metric: DistanceMetric.Cosine,
      matryoshkaDims: [64, 256, 1536],
    })

    for (let i = 0; i < 100; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(1536, i * 100))
    }

    const query = randomNormalizedVector(1536, 5000) // Same as vec_50

    // Search with 64-dim truncation
    const results64 = await index.search(query, 10, { dimension: 64 })

    // Search with 256-dim truncation
    const results256 = await index.search(query, 10, { dimension: 256 })

    // Search with full 1536-dim
    const results1536 = await index.search(query, 10, { dimension: 1536 })

    // All should return results
    expect(results64).toHaveLength(10)
    expect(results256).toHaveLength(10)
    expect(results1536).toHaveLength(10)

    // Full dimension should have highest accuracy
    expect(results1536[0].id).toBe('vec_50')
  })

  it('should achieve high recall with 256-dim truncation', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({
      dimension: 1536,
      metric: DistanceMetric.Cosine,
      matryoshkaDims: [64, 256, 1536],
    })

    // Insert vectors
    const vectors: { id: string; embedding: Float32Array }[] = []
    for (let i = 0; i < 1000; i++) {
      const embedding = randomNormalizedVector(1536, i * 100)
      vectors.push({ id: `vec_${i}`, embedding })
      await index.add(`vec_${i}`, embedding)
    }

    // Test recall with 256-dim vs full dimension
    let recall256Total = 0
    const numQueries = 20

    for (let q = 0; q < numQueries; q++) {
      const query = randomNormalizedVector(1536, q * 5000)

      // Ground truth with full dimension
      const groundTruth = vectors
        .map((v) => ({
          id: v.id,
          similarity: cosineSimilarity(query, v.embedding),
        }))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 10)
        .map((v) => v.id)

      // Search with 256-dim
      const results256 = await index.search(query, 10, { dimension: 256 })
      const resultIds256 = results256.map((r: any) => r.id)

      const hits = groundTruth.filter((id) => resultIds256.includes(id)).length
      recall256Total += hits / 10
    }

    const recall256 = recall256Total / numQueries

    // 256-dim should achieve > 90% recall
    expect(recall256).toBeGreaterThan(0.9)
  })

  it('should achieve reasonable recall with 64-dim truncation', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({
      dimension: 1536,
      metric: DistanceMetric.Cosine,
      matryoshkaDims: [64, 256, 1536],
    })

    // Insert vectors
    const vectors: { id: string; embedding: Float32Array }[] = []
    for (let i = 0; i < 1000; i++) {
      const embedding = randomNormalizedVector(1536, i * 100)
      vectors.push({ id: `vec_${i}`, embedding })
      await index.add(`vec_${i}`, embedding)
    }

    // Test recall with 64-dim
    let recall64Total = 0
    const numQueries = 20

    for (let q = 0; q < numQueries; q++) {
      const query = randomNormalizedVector(1536, q * 5000)

      // Ground truth with full dimension
      const groundTruth = vectors
        .map((v) => ({
          id: v.id,
          similarity: cosineSimilarity(query, v.embedding),
        }))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 10)
        .map((v) => v.id)

      // Search with 64-dim
      const results64 = await index.search(query, 10, { dimension: 64 })
      const resultIds64 = results64.map((r: any) => r.id)

      const hits = groundTruth.filter((id) => resultIds64.includes(id)).length
      recall64Total += hits / 10
    }

    const recall64 = recall64Total / numQueries

    // 64-dim should achieve > 70% recall (lower than 256-dim but still useful)
    expect(recall64).toBeGreaterThan(0.7)
  })

  it('should automatically store matryoshka truncations', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({
      dimension: 1536,
      matryoshkaDims: [64, 256, 1536],
    })

    const fullVector = randomNormalizedVector(1536, 42)
    await index.add('vec_1', fullVector)

    // Get stored truncations
    const stored = await index.getWithTruncations('vec_1')

    expect(stored.full).toBeInstanceOf(Float32Array)
    expect(stored.full.length).toBe(1536)

    expect(stored.mat_64).toBeInstanceOf(Float32Array)
    expect(stored.mat_64.length).toBe(64)

    expect(stored.mat_256).toBeInstanceOf(Float32Array)
    expect(stored.mat_256.length).toBe(256)

    // Truncations should match original prefix
    for (let i = 0; i < 64; i++) {
      expect(stored.mat_64[i]).toBeCloseTo(fullVector[i], 5)
    }
    for (let i = 0; i < 256; i++) {
      expect(stored.mat_256[i]).toBeCloseTo(fullVector[i], 5)
    }
  })

  it('should compute storage savings for truncations', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({
      dimension: 1536,
      matryoshkaDims: [64, 256, 1536],
    })

    const savings = index.getStorageSavings()

    // 64-dim: 64/1536 = 4.2%, savings = 95.8%
    expect(savings[64].savingsPercent).toBeCloseTo(95.8, 1)

    // 256-dim: 256/1536 = 16.7%, savings = 83.3%
    expect(savings[256].savingsPercent).toBeCloseTo(83.3, 1)

    // 1536-dim: no savings
    expect(savings[1536].savingsPercent).toBe(0)
  })

  it('should support progressive search with matryoshka', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({
      dimension: 1536,
      metric: DistanceMetric.Cosine,
      matryoshkaDims: [64, 256, 1536],
    })

    for (let i = 0; i < 1000; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(1536, i))
    }

    const query = randomNormalizedVector(1536, 500)

    // Progressive search: 64-dim -> 256-dim -> 1536-dim
    const results = await index.progressiveSearch(query, 10, {
      stages: [
        { dimension: 64, candidates: 100 },
        { dimension: 256, candidates: 30 },
        { dimension: 1536, candidates: 10 },
      ],
      returnTiming: true,
    })

    expect(results.results).toHaveLength(10)
    expect(results.timing).toBeDefined()
    expect(results.timing.stages).toHaveLength(3)
    expect(results.timing.stages[0].name).toBe('matryoshka_64')
    expect(results.timing.stages[1].name).toBe('matryoshka_256')
    expect(results.timing.stages[2].name).toBe('exact')
  })
})

// ============================================================================
// TESTS: Batch Operations
// ============================================================================

describe('FlatIndex - Batch Operations', () => {
  it('should add vectors in batch', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({ dimension: 1536 })

    const vectors = Array.from({ length: 100 }, (_, i) => ({
      id: `vec_${i}`,
      vector: randomNormalizedVector(1536, i),
    }))

    await index.addBatch(vectors)

    expect(index.size).toBe(100)

    // All vectors should be retrievable
    for (let i = 0; i < 100; i++) {
      expect(index.has(`vec_${i}`)).toBe(true)
    }
  })

  it('should be faster for batch insert than individual inserts', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index1 = new FlatIndex({ dimension: 1536 })
    const index2 = new FlatIndex({ dimension: 1536 })

    const vectors = Array.from({ length: 1000 }, (_, i) => ({
      id: `vec_${i}`,
      vector: randomNormalizedVector(1536, i),
    }))

    // Individual inserts
    const startIndividual = performance.now()
    for (const v of vectors) {
      await index1.add(v.id, v.vector)
    }
    const individualTime = performance.now() - startIndividual

    // Batch insert
    const startBatch = performance.now()
    await index2.addBatch(vectors)
    const batchTime = performance.now() - startBatch

    // Batch should be significantly faster
    expect(batchTime).toBeLessThan(individualTime)
  })

  it('should remove vectors in batch', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({ dimension: 1536 })

    for (let i = 0; i < 100; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(1536, i))
    }

    expect(index.size).toBe(100)

    // Remove half
    const idsToRemove = Array.from({ length: 50 }, (_, i) => `vec_${i * 2}`)
    await index.removeBatch(idsToRemove)

    expect(index.size).toBe(50)

    // Removed vectors should not exist
    for (const id of idsToRemove) {
      expect(index.has(id)).toBe(false)
    }
  })

  it('should search multiple queries in batch', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({ dimension: 1536, metric: DistanceMetric.Cosine })

    for (let i = 0; i < 100; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(1536, i * 100))
    }

    const queries = [
      randomNormalizedVector(1536, 1000), // Similar to vec_10
      randomNormalizedVector(1536, 5000), // Similar to vec_50
      randomNormalizedVector(1536, 9000), // Similar to vec_90
    ]

    const batchResults = await index.searchBatch(queries, 5)

    expect(batchResults).toHaveLength(3)

    // Each result set should have 5 results
    for (const results of batchResults) {
      expect(results).toHaveLength(5)
    }

    // First results should match expected vectors
    expect(batchResults[0][0].id).toBe('vec_10')
    expect(batchResults[1][0].id).toBe('vec_50')
    expect(batchResults[2][0].id).toBe('vec_90')
  })
})

// ============================================================================
// TESTS: Edge Cases and Error Handling
// ============================================================================

describe('FlatIndex - Edge Cases', () => {
  it('should handle zero vectors', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({ dimension: 4 })

    const zeroVector = new Float32Array([0, 0, 0, 0])

    // Should handle or reject zero vectors gracefully
    await expect(index.add('zero', zeroVector)).rejects.toThrow(/zero.*vector|invalid.*norm/i)
  })

  it('should handle very small vectors', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({ dimension: 4, metric: DistanceMetric.Cosine })

    const smallVector = new Float32Array([1e-10, 1e-10, 1e-10, 1e-10])

    // Should normalize or handle appropriately
    await index.add('small', smallVector)

    const results = await index.search(smallVector, 1)
    expect(results[0].id).toBe('small')
    expect(results[0].similarity).toBeCloseTo(1.0, 3)
  })

  it('should handle very large vector values', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({ dimension: 4, metric: DistanceMetric.Cosine })

    const largeVector = new Float32Array([1e10, 1e10, 1e10, 1e10])

    await index.add('large', largeVector)

    const results = await index.search(largeVector, 1)
    expect(results[0].id).toBe('large')
    expect(results[0].similarity).toBeCloseTo(1.0, 3)
  })

  it('should handle NaN values in vectors', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({ dimension: 4 })

    const nanVector = new Float32Array([1, NaN, 3, 4])

    await expect(index.add('nan', nanVector)).rejects.toThrow(/nan|invalid.*value/i)
  })

  it('should handle Infinity values in vectors', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({ dimension: 4 })

    const infVector = new Float32Array([1, Infinity, 3, 4])

    await expect(index.add('inf', infVector)).rejects.toThrow(/infinity|invalid.*value/i)
  })

  it('should handle search with k > size', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({ dimension: 1536 })

    for (let i = 0; i < 5; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(1536, i))
    }

    // Request more results than exist
    const results = await index.search(randomNormalizedVector(1536, 2), 100)

    // Should return all available (5), not 100
    expect(results).toHaveLength(5)
  })

  it('should handle concurrent modifications', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({ dimension: 1536 })

    // Concurrent adds
    const promises = Array.from({ length: 100 }, (_, i) =>
      index.add(`vec_${i}`, randomNormalizedVector(1536, i))
    )

    await Promise.all(promises)

    expect(index.size).toBe(100)
  })

  it('should handle empty batch operations', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({ dimension: 1536 })

    await index.addBatch([])
    expect(index.size).toBe(0)

    await index.removeBatch([])
    expect(index.size).toBe(0)

    const results = await index.searchBatch([], 10)
    expect(results).toEqual([])
  })
})

// ============================================================================
// TESTS: Serialization and Persistence
// ============================================================================

describe('FlatIndex - Serialization', () => {
  it('should serialize index to buffer', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({ dimension: 1536 })

    for (let i = 0; i < 100; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(1536, i))
    }

    const buffer = await index.serialize()

    expect(buffer).toBeInstanceOf(ArrayBuffer)
    expect(buffer.byteLength).toBeGreaterThan(0)
  })

  it('should deserialize index from buffer', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index1 = new FlatIndex({ dimension: 1536, metric: DistanceMetric.Cosine })

    const testVector = randomNormalizedVector(1536, 42)
    await index1.add('test', testVector)

    const buffer = await index1.serialize()

    const index2 = await FlatIndex.deserialize(buffer)

    expect(index2.size).toBe(1)
    expect(index2.dimension).toBe(1536)

    const retrieved = await index2.get('test')
    expect(cosineSimilarity(retrieved, testVector)).toBeCloseTo(1.0, 5)
  })

  it('should preserve search quality after serialization round-trip', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index1 = new FlatIndex({ dimension: 1536, metric: DistanceMetric.Cosine })

    for (let i = 0; i < 100; i++) {
      await index1.add(`vec_${i}`, randomNormalizedVector(1536, i * 100))
    }

    const query = randomNormalizedVector(1536, 5000)
    const originalResults = await index1.search(query, 10)

    const buffer = await index1.serialize()
    const index2 = await FlatIndex.deserialize(buffer)

    const deserializedResults = await index2.search(query, 10)

    // Results should be identical
    expect(deserializedResults).toHaveLength(10)
    for (let i = 0; i < 10; i++) {
      expect(deserializedResults[i].id).toBe(originalResults[i].id)
      expect(deserializedResults[i].similarity).toBeCloseTo(originalResults[i].similarity, 5)
    }
  })
})

// ============================================================================
// TESTS: Index Statistics and Diagnostics
// ============================================================================

describe('FlatIndex - Statistics and Diagnostics', () => {
  it('should report index statistics', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({
      dimension: 1536,
      metric: DistanceMetric.Cosine,
      matryoshkaDims: [64, 256, 1536],
    })

    for (let i = 0; i < 1000; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(1536, i))
    }

    const stats = index.getStats()

    expect(stats.vectorCount).toBe(1000)
    expect(stats.dimension).toBe(1536)
    expect(stats.metric).toBe('cosine')
    expect(stats.matryoshkaDims).toEqual([64, 256, 1536])
    expect(stats.memoryBytes).toBeGreaterThan(0)
  })

  it('should compute similarity distribution', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({ dimension: 1536, metric: DistanceMetric.Cosine })

    for (let i = 0; i < 100; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(1536, i))
    }

    const query = randomNormalizedVector(1536, 50)
    const distribution = await index.computeSimilarityDistribution(query)

    expect(distribution).toHaveProperty('min')
    expect(distribution).toHaveProperty('max')
    expect(distribution).toHaveProperty('mean')
    expect(distribution).toHaveProperty('median')
    expect(distribution).toHaveProperty('stddev')

    expect(distribution.min).toBeLessThanOrEqual(distribution.median)
    expect(distribution.median).toBeLessThanOrEqual(distribution.max)
  })

  it('should identify duplicate vectors', async () => {
    assertModuleLoaded('FlatIndex', FlatIndex)

    const index = new FlatIndex({ dimension: 1536, metric: DistanceMetric.Cosine })

    const sharedVector = randomNormalizedVector(1536, 42)

    await index.add('vec_1', sharedVector)
    await index.add('vec_2', randomNormalizedVector(1536, 99))
    await index.add('vec_3', sharedVector) // Duplicate of vec_1

    const duplicates = await index.findDuplicates(0.9999) // Threshold for near-duplicates

    expect(duplicates).toContainEqual(expect.arrayContaining(['vec_1', 'vec_3']))
  })
})
