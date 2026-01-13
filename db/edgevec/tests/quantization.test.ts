/**
 * Vector Quantization Tests
 *
 * RED phase TDD tests for Product Quantization (PQ), Scalar Quantization (SQ),
 * and Binary Quantization. These tests define expected behavior for memory-efficient
 * vector storage with approximate search.
 *
 * @module db/edgevec/tests/quantization.test
 */

import { describe, it, expect, beforeEach } from 'vitest'

import {
  ProductQuantizer,
  ScalarQuantizer,
  type PQConfig,
  type SQConfig,
  type QuantizedIndex,
} from '../quantization'

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
 * Compute L2 (Euclidean) distance squared between two vectors
 */
function l2DistanceSquared(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i]
    sum += diff * diff
  }
  return sum
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
 * Generate training vectors for quantizer
 */
function generateTrainingVectors(count: number, dim: number): Float32Array[] {
  return Array.from({ length: count }, (_, i) => seededVector(dim, i))
}

/**
 * Compute mean squared quantization error
 */
function computeQuantizationError(
  original: Float32Array[],
  reconstructed: Float32Array[]
): number {
  let totalError = 0
  for (let i = 0; i < original.length; i++) {
    totalError += l2DistanceSquared(original[i], reconstructed[i])
  }
  return totalError / original.length
}

// ============================================================================
// PRODUCT QUANTIZATION - TRAINING
// ============================================================================

describe('Product Quantization - Training', () => {
  it('trains codebook correctly with k-means convergence', async () => {
    const pq = new ProductQuantizer({
      dimensions: 128,
      numSubvectors: 8,
      numCentroids: 256,
      trainingIterations: 25,
    })

    const trainingVectors = generateTrainingVectors(5000, 128)

    await pq.train(trainingVectors)

    expect(pq.isTrained()).toBe(true)
    expect(pq.numSubvectors()).toBe(8)
    expect(pq.numCentroids()).toBe(256)
  })

  it('throws error for insufficient training vectors', async () => {
    const pq = new ProductQuantizer({
      dimensions: 128,
      numSubvectors: 8,
      numCentroids: 256,
    })

    // 256 centroids * 10 = 2560 minimum required
    const tooFewVectors = generateTrainingVectors(100, 128)

    await expect(pq.train(tooFewVectors)).rejects.toThrow(/insufficient training vectors/)
  })

  it('validates dimensions must be divisible by numSubvectors', () => {
    expect(() =>
      new ProductQuantizer({
        dimensions: 100,
        numSubvectors: 8, // 100 not divisible by 8
      })
    ).toThrow(/must be divisible/)
  })

  it('achieves reasonable quantization error after training', async () => {
    const pq = new ProductQuantizer({
      dimensions: 64,
      numSubvectors: 8,
      numCentroids: 256,
      trainingIterations: 25,
    })

    const trainingVectors = generateTrainingVectors(3000, 64)
    await pq.train(trainingVectors)

    // Test quantization error on held-out set
    const testVectors = Array.from({ length: 100 }, (_, i) =>
      seededVector(64, i + 10000)
    )

    const reconstructed = testVectors.map((v) => {
      const codes = pq.encode(v)
      return pq.decode(codes)
    })

    const mse = computeQuantizationError(testVectors, reconstructed)

    // Quantization should preserve most information
    // MSE should be reasonably low for normalized vectors
    expect(mse).toBeLessThan(0.5) // Reasonable bound for PQ
  })

  it('handles small training set with fewer centroids', async () => {
    const pq = new ProductQuantizer({
      dimensions: 32,
      numSubvectors: 4,
      numCentroids: 16, // Fewer centroids = fewer training vectors needed
      trainingIterations: 10,
    })

    // 16 centroids * 10 = 160 minimum
    const trainingVectors = generateTrainingVectors(200, 32)

    await pq.train(trainingVectors)

    expect(pq.isTrained()).toBe(true)
  })

  it('k-means converges within iteration limit', async () => {
    const pq = new ProductQuantizer({
      dimensions: 64,
      numSubvectors: 4,
      numCentroids: 64,
      trainingIterations: 5, // Low iteration count
    })

    const trainingVectors = generateTrainingVectors(1000, 64)

    // Should complete within timeout
    const startTime = performance.now()
    await pq.train(trainingVectors)
    const elapsed = performance.now() - startTime

    expect(pq.isTrained()).toBe(true)
    expect(elapsed).toBeLessThan(10000) // Should finish within 10 seconds
  })
})

// ============================================================================
// PRODUCT QUANTIZATION - ENCODING/DECODING
// ============================================================================

describe('Product Quantization - Encoding/Decoding', () => {
  let pq: ProductQuantizer

  beforeEach(async () => {
    pq = new ProductQuantizer({
      dimensions: 64,
      numSubvectors: 8,
      numCentroids: 256,
      trainingIterations: 20,
    })

    const trainingVectors = generateTrainingVectors(3000, 64)
    await pq.train(trainingVectors)
  })

  it('encodes vectors to codes', () => {
    const vector = seededVector(64, 42)
    const codes = pq.encode(vector)

    expect(codes).toBeInstanceOf(Uint8Array)
    expect(codes.length).toBe(8) // numSubvectors
    // Each code should be 0-255 (valid centroid index)
    for (const code of codes) {
      expect(code).toBeGreaterThanOrEqual(0)
      expect(code).toBeLessThan(256)
    }
  })

  it('throws when encoding before training', () => {
    const untrained = new ProductQuantizer({
      dimensions: 64,
      numSubvectors: 8,
    })

    const vector = seededVector(64, 42)

    expect(() => untrained.encode(vector)).toThrow(/not trained/)
  })

  it('decodes codes to approximate vectors', () => {
    const original = seededVector(64, 42)
    const codes = pq.encode(original)
    const decoded = pq.decode(codes)

    expect(decoded).toBeInstanceOf(Float32Array)
    expect(decoded.length).toBe(64)

    // Decoded should be reasonably close to original
    const similarity = cosineSimilarity(original, decoded)
    expect(similarity).toBeGreaterThan(0.7) // Should preserve direction
  })

  it('batch encodes multiple vectors', () => {
    const vectors = Array.from({ length: 10 }, (_, i) => seededVector(64, i))
    const batchCodes = pq.encodeBatch(vectors)

    expect(batchCodes).toHaveLength(10)
    batchCodes.forEach((codes) => {
      expect(codes).toBeInstanceOf(Uint8Array)
      expect(codes.length).toBe(8)
    })
  })

  it('encode/decode is deterministic', () => {
    const vector = seededVector(64, 42)

    const codes1 = pq.encode(vector)
    const codes2 = pq.encode(vector)

    expect(codes1).toEqual(codes2)

    const decoded1 = pq.decode(codes1)
    const decoded2 = pq.decode(codes2)

    expect(decoded1).toEqual(decoded2)
  })

  it('similar vectors produce similar codes', () => {
    // Create two similar vectors
    const v1 = seededVector(64, 42)
    const v2 = new Float32Array(64)
    for (let i = 0; i < 64; i++) {
      v2[i] = v1[i] + (Math.random() - 0.5) * 0.1 // Small perturbation
    }

    const codes1 = pq.encode(v1)
    const codes2 = pq.encode(v2)

    // At least some codes should match
    let matchingCodes = 0
    for (let i = 0; i < codes1.length; i++) {
      if (codes1[i] === codes2[i]) matchingCodes++
    }

    expect(matchingCodes).toBeGreaterThan(2) // More than random chance
  })
})

// ============================================================================
// PRODUCT QUANTIZATION - ASYMMETRIC DISTANCE
// ============================================================================

describe('Product Quantization - Asymmetric Distance', () => {
  let pq: ProductQuantizer

  beforeEach(async () => {
    pq = new ProductQuantizer({
      dimensions: 64,
      numSubvectors: 8,
      numCentroids: 256,
      trainingIterations: 20,
    })

    const trainingVectors = generateTrainingVectors(3000, 64)
    await pq.train(trainingVectors)
  })

  it('computes distance lookup table', () => {
    const query = seededVector(64, 42)
    const table = pq.computeDistanceTable(query)

    expect(table).toHaveLength(8) // numSubvectors
    table.forEach((t) => {
      expect(t).toBeInstanceOf(Float32Array)
      expect(t.length).toBe(256) // numCentroids
    })
  })

  it('computes asymmetric distance correctly', () => {
    const query = seededVector(64, 42)
    const vector = seededVector(64, 100)
    const codes = pq.encode(vector)

    const lookupTable = pq.computeDistanceTable(query)
    const adcDistance = pq.asymmetricDistance(codes, lookupTable)

    // ADC distance should approximate true squared distance
    const decoded = pq.decode(codes)
    const trueDistance = l2DistanceSquared(query, decoded)

    // Should be equal since ADC computes distance to decoded centroids
    expect(Math.abs(adcDistance - trueDistance)).toBeLessThan(0.001)
  })

  it('ADC distance approximates true L2 distance', () => {
    const query = seededVector(64, 42)
    const vector = seededVector(64, 100)
    const codes = pq.encode(vector)

    const lookupTable = pq.computeDistanceTable(query)
    const adcDistance = pq.asymmetricDistance(codes, lookupTable)

    // Compare to true distance to original vector
    const trueDistance = l2DistanceSquared(query, vector)

    // ADC should be in the same ballpark
    // Allow significant error since PQ is lossy
    const relativeError = Math.abs(adcDistance - trueDistance) / Math.max(trueDistance, 0.001)
    expect(relativeError).toBeLessThan(1.0) // Within 100% relative error
  })

  it('batch asymmetric distance computation', () => {
    const query = seededVector(64, 42)
    const vectors = Array.from({ length: 100 }, (_, i) => seededVector(64, i))
    const codes = vectors.map((v) => pq.encode(v))

    const lookupTable = pq.computeDistanceTable(query)
    const distances = pq.batchAsymmetricDistance(codes, lookupTable)

    expect(distances).toBeInstanceOf(Float32Array)
    expect(distances.length).toBe(100)

    // All distances should be non-negative
    for (const d of distances) {
      expect(d).toBeGreaterThanOrEqual(0)
    }
  })

  it('ADC preserves distance ordering', () => {
    const query = seededVector(64, 42)
    const vectors = Array.from({ length: 50 }, (_, i) => seededVector(64, i))

    // Compute true distances
    const trueDistances = vectors.map((v) => ({
      distance: l2DistanceSquared(query, v),
    }))

    // Compute ADC distances
    const codes = vectors.map((v) => pq.encode(v))
    const lookupTable = pq.computeDistanceTable(query)
    const adcDistances = vectors.map((_, i) =>
      pq.asymmetricDistance(codes[i], lookupTable)
    )

    // Find top 10 by true distance
    const trueTop10 = trueDistances
      .map((d, i) => ({ i, d: d.distance }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 10)
      .map((x) => x.i)

    // Find top 10 by ADC distance
    const adcTop10 = adcDistances
      .map((d, i) => ({ i, d }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 10)
      .map((x) => x.i)

    // Calculate overlap (recall)
    const overlap = trueTop10.filter((i) => adcTop10.includes(i)).length
    expect(overlap).toBeGreaterThanOrEqual(3) // At least 30% recall
  })
})

// ============================================================================
// PRODUCT QUANTIZATION - INDEX
// ============================================================================

describe('Product Quantization - Index', () => {
  let pq: ProductQuantizer
  let index: QuantizedIndex

  beforeEach(async () => {
    pq = new ProductQuantizer({
      dimensions: 64,
      numSubvectors: 8,
      numCentroids: 256,
      trainingIterations: 20,
    })

    const trainingVectors = generateTrainingVectors(3000, 64)
    await pq.train(trainingVectors)

    index = pq.createIndex()
  })

  it('creates empty index', () => {
    expect(index.size()).toBe(0)
  })

  it('inserts vectors into index', () => {
    for (let i = 0; i < 100; i++) {
      index.insert(`vec-${i}`, seededVector(64, i))
    }

    expect(index.size()).toBe(100)
  })

  it('searches index and returns results', () => {
    for (let i = 0; i < 100; i++) {
      index.insert(`vec-${i}`, seededVector(64, i))
    }

    const query = seededVector(64, 42)
    const results = index.search(query, { k: 10 })

    expect(results).toHaveLength(10)
    results.forEach((r) => {
      expect(r).toHaveProperty('id')
      expect(r).toHaveProperty('score')
      expect(r.id).toMatch(/^vec-\d+$/)
    })
  })

  it('returns results sorted by score', () => {
    for (let i = 0; i < 100; i++) {
      index.insert(`vec-${i}`, seededVector(64, i))
    }

    const query = seededVector(64, 42)
    const results = index.search(query, { k: 10 })

    // Higher score = more similar (negative distance)
    for (let i = 1; i < results.length; i++) {
      expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score)
    }
  })

  it('reports memory usage', () => {
    for (let i = 0; i < 100; i++) {
      index.insert(`vec-${i}`, seededVector(64, i))
    }

    const memory = index.memoryUsage()

    expect(memory).toBeGreaterThan(0)
    // PQ codes: 100 vectors * 8 subvectors = 800 bytes
    // Plus ID overhead
    expect(memory).toBeGreaterThanOrEqual(800)
  })

  it('achieves memory compression vs full vectors', () => {
    const numVectors = 1000
    const dimensions = 64

    for (let i = 0; i < numVectors; i++) {
      index.insert(`vec-${i}`, seededVector(dimensions, i))
    }

    const pqMemory = index.memoryUsage()
    const fullMemory = numVectors * dimensions * 4 // Float32 = 4 bytes

    // PQ should use significantly less memory
    // 8 subvectors = 8 bytes per vector vs 256 bytes (32x compression)
    const compressionRatio = fullMemory / pqMemory
    expect(compressionRatio).toBeGreaterThan(5) // At least 5x compression
  })
})

// ============================================================================
// SCALAR QUANTIZATION - TRAINING
// ============================================================================

describe('Scalar Quantization - Training', () => {
  it('trains min/max bounds from data', async () => {
    const sq = new ScalarQuantizer({
      dimensions: 64,
      bits: 8,
    })

    const trainingVectors = generateTrainingVectors(100, 64)
    await sq.train(trainingVectors)

    expect(sq.isTrained()).toBe(true)
  })

  it('works without training using default bounds', () => {
    const sq = new ScalarQuantizer({
      dimensions: 64,
      bits: 8,
    })

    const vector = seededVector(64, 42)
    const quantized = sq.quantize(vector)

    expect(quantized).toBeInstanceOf(Int8Array)
    expect(quantized.length).toBe(64)
  })

  it('handles different value scales correctly', async () => {
    const sq = new ScalarQuantizer({
      dimensions: 4,
      bits: 8,
    })

    // Training data with different scales per dimension
    const trainingVectors = [
      new Float32Array([0, 0, 0, 0]),
      new Float32Array([100, 10, 1, 0.1]),
      new Float32Array([50, 5, 0.5, 0.05]),
    ]

    await sq.train(trainingVectors)

    // Quantize a vector
    const test = new Float32Array([50, 5, 0.5, 0.05])
    const quantized = sq.quantize(test)

    // All values should map to middle of range (roughly 0 in int8)
    for (const q of quantized) {
      expect(q).toBeGreaterThan(-100)
      expect(q).toBeLessThan(100)
    }
  })
})

// ============================================================================
// SCALAR QUANTIZATION - QUANTIZE/DEQUANTIZE
// ============================================================================

describe('Scalar Quantization - Quantize/Dequantize', () => {
  let sq: ScalarQuantizer

  beforeEach(async () => {
    sq = new ScalarQuantizer({
      dimensions: 64,
      bits: 8,
    })

    const trainingVectors = generateTrainingVectors(500, 64)
    await sq.train(trainingVectors)
  })

  it('quantizes to int8', () => {
    const vector = seededVector(64, 42)
    const quantized = sq.quantize(vector)

    expect(quantized).toBeInstanceOf(Int8Array)
    expect(quantized.length).toBe(64)

    // All values should be in int8 range
    for (const q of quantized) {
      expect(q).toBeGreaterThanOrEqual(-128)
      expect(q).toBeLessThanOrEqual(127)
    }
  })

  it('batch quantizes multiple vectors', () => {
    const vectors = Array.from({ length: 10 }, (_, i) => seededVector(64, i))
    const batchQuantized = sq.quantizeBatch(vectors)

    expect(batchQuantized).toHaveLength(10)
    batchQuantized.forEach((q) => {
      expect(q).toBeInstanceOf(Int8Array)
      expect(q.length).toBe(64)
    })
  })

  it('dequantizes back to approximate float32', () => {
    const original = seededVector(64, 42)
    const quantized = sq.quantize(original)
    const dequantized = sq.dequantize(quantized)

    expect(dequantized).toBeInstanceOf(Float32Array)
    expect(dequantized.length).toBe(64)

    // Should be reasonably close to original
    const similarity = cosineSimilarity(original, dequantized)
    expect(similarity).toBeGreaterThan(0.9) // SQ should preserve well
  })

  it('quantize/dequantize is deterministic', () => {
    const vector = seededVector(64, 42)

    const q1 = sq.quantize(vector)
    const q2 = sq.quantize(vector)
    expect(q1).toEqual(q2)

    const d1 = sq.dequantize(q1)
    const d2 = sq.dequantize(q2)
    expect(d1).toEqual(d2)
  })

  it('preserves relative distances between vectors', async () => {
    const vectors = Array.from({ length: 20 }, (_, i) => seededVector(64, i))

    // Compute original pairwise distances
    const originalDistances: number[][] = []
    for (let i = 0; i < vectors.length; i++) {
      originalDistances[i] = []
      for (let j = 0; j < vectors.length; j++) {
        originalDistances[i][j] = l2DistanceSquared(vectors[i], vectors[j])
      }
    }

    // Quantize and compute quantized pairwise distances
    const quantized = vectors.map((v) => sq.quantize(v))
    const dequantized = quantized.map((q) => sq.dequantize(q))

    const quantizedDistances: number[][] = []
    for (let i = 0; i < dequantized.length; i++) {
      quantizedDistances[i] = []
      for (let j = 0; j < dequantized.length; j++) {
        quantizedDistances[i][j] = l2DistanceSquared(dequantized[i], dequantized[j])
      }
    }

    // Correlation should be high - check ordering preservation
    let orderPreserved = 0
    let total = 0
    for (let i = 0; i < vectors.length; i++) {
      for (let j = i + 1; j < vectors.length; j++) {
        for (let k = j + 1; k < vectors.length; k++) {
          total++
          const origOrder = originalDistances[i][j] < originalDistances[i][k]
          const quantOrder = quantizedDistances[i][j] < quantizedDistances[i][k]
          if (origOrder === quantOrder) orderPreserved++
        }
      }
    }

    const preservationRate = orderPreserved / total
    expect(preservationRate).toBeGreaterThan(0.7) // 70% order preservation
  })

  it('quantization error is bounded', async () => {
    const testVectors = Array.from({ length: 100 }, (_, i) =>
      seededVector(64, i + 10000)
    )

    const reconstructed = testVectors.map((v) => {
      const q = sq.quantize(v)
      return sq.dequantize(q)
    })

    const mse = computeQuantizationError(testVectors, reconstructed)

    // SQ should have very low error for normalized vectors
    expect(mse).toBeLessThan(0.1)
  })
})

// ============================================================================
// SCALAR QUANTIZATION - DISTANCE COMPUTATION
// ============================================================================

describe('Scalar Quantization - Distance Computation', () => {
  let sq: ScalarQuantizer

  beforeEach(async () => {
    sq = new ScalarQuantizer({
      dimensions: 64,
      bits: 8,
    })

    const trainingVectors = generateTrainingVectors(500, 64)
    await sq.train(trainingVectors)
  })

  it('computes dot product on int8 vectors', () => {
    const v1 = seededVector(64, 1)
    const v2 = seededVector(64, 2)

    const q1 = sq.quantize(v1)
    const q2 = sq.quantize(v2)

    const dot = sq.dotProduct(q1, q2)

    expect(typeof dot).toBe('number')
  })

  it('dot product is commutative', () => {
    const v1 = seededVector(64, 1)
    const v2 = seededVector(64, 2)

    const q1 = sq.quantize(v1)
    const q2 = sq.quantize(v2)

    expect(sq.dotProduct(q1, q2)).toBe(sq.dotProduct(q2, q1))
  })

  it('dot product with self is maximum', () => {
    const v = seededVector(64, 42)
    const q = sq.quantize(v)

    const selfDot = sq.dotProduct(q, q)

    // Compare with dot products to other vectors
    for (let i = 0; i < 10; i++) {
      if (i === 42) continue
      const other = sq.quantize(seededVector(64, i))
      const otherDot = sq.dotProduct(q, other)
      expect(selfDot).toBeGreaterThan(otherDot)
    }
  })
})

// ============================================================================
// SCALAR QUANTIZATION - INDEX
// ============================================================================

describe('Scalar Quantization - Index', () => {
  let sq: ScalarQuantizer
  let index: QuantizedIndex

  beforeEach(async () => {
    sq = new ScalarQuantizer({
      dimensions: 64,
      bits: 8,
    })

    const trainingVectors = generateTrainingVectors(500, 64)
    await sq.train(trainingVectors)

    index = sq.createIndex()
  })

  it('creates empty index', () => {
    expect(index.size()).toBe(0)
  })

  it('inserts and searches', () => {
    for (let i = 0; i < 100; i++) {
      index.insert(`vec-${i}`, seededVector(64, i))
    }

    const query = seededVector(64, 42)
    const results = index.search(query, { k: 10 })

    expect(results).toHaveLength(10)
    // Query vector vec-42 should be in top results
    const ids = results.map((r) => r.id)
    expect(ids).toContain('vec-42')
  })

  it('reports memory usage', () => {
    for (let i = 0; i < 100; i++) {
      index.insert(`vec-${i}`, seededVector(64, i))
    }

    const memory = index.memoryUsage()

    expect(memory).toBeGreaterThan(0)
    // SQ vectors: 100 vectors * 64 dimensions * 1 byte = 6400 bytes
    expect(memory).toBeGreaterThanOrEqual(6400)
  })
})

// ============================================================================
// BINARY QUANTIZATION (To be implemented)
// ============================================================================

// Note: BinaryQuantizer class does not exist yet in quantization.ts
// These tests define the expected API for when it is implemented

describe('Binary Quantization - Binarization', () => {
  it('binarizes vectors using sign threshold', async () => {
    // Binary quantization: value >= 0 -> 1, value < 0 -> 0
    // This reduces each float32 to a single bit (32x compression)
    const { BinaryQuantizer } = await import('../quantization')

    const bq = new BinaryQuantizer({ dimensions: 64 })
    const vector = new Float32Array([
      0.5, -0.3, 0.0, 0.1, -0.9, 0.7, -0.2, 0.4, // First 8 values
      ...new Array(56).fill(0).map((_, i) => (i % 2 === 0 ? 0.1 : -0.1))
    ])

    const binary = bq.binarize(vector)

    expect(binary).toBeInstanceOf(Uint8Array)
    // First byte: 0.5>0(1), -0.3<0(0), 0>=0(1), 0.1>0(1), -0.9<0(0), 0.7>0(1), -0.2<0(0), 0.4>0(1)
    // = 10110101 = 181 (if MSB first) or 10101101 = 173 (if LSB first)
    expect(binary.length).toBe(8) // 64 bits = 8 bytes
  })

  it('produces Uint8Array packed bits', async () => {
    const { BinaryQuantizer } = await import('../quantization')

    const bq = new BinaryQuantizer({ dimensions: 128 })
    const vector = randomVector(128)

    const binary = bq.binarize(vector)

    expect(binary).toBeInstanceOf(Uint8Array)
    expect(binary.length).toBe(16) // 128 bits = 16 bytes
  })

  it('handles vectors not divisible by 8', async () => {
    const { BinaryQuantizer } = await import('../quantization')

    // 100 dimensions -> should pad to 104 bits (13 bytes) or handle 100 bits as 13 bytes
    const bq = new BinaryQuantizer({ dimensions: 100 })
    const vector = randomVector(100)

    const binary = bq.binarize(vector)

    expect(binary).toBeInstanceOf(Uint8Array)
    expect(binary.length).toBe(13) // ceil(100/8) = 13
  })
})

describe('Binary Quantization - Hamming Distance', () => {
  it('computes hamming distance correctly', async () => {
    const { BinaryQuantizer } = await import('../quantization')

    const bq = new BinaryQuantizer({ dimensions: 64 })

    // Create two vectors with known bit differences
    const v1 = new Float32Array(64).fill(0.5) // All positive -> all 1s
    const v2 = new Float32Array(64)
    for (let i = 0; i < 64; i++) {
      v2[i] = i < 10 ? -0.5 : 0.5 // 10 negative, 54 positive
    }

    const b1 = bq.binarize(v1)
    const b2 = bq.binarize(v2)

    const distance = bq.hammingDistance(b1, b2)

    expect(distance).toBe(10) // 10 bits different
  })

  it('hamming distance of vector with itself is 0', async () => {
    const { BinaryQuantizer } = await import('../quantization')

    const bq = new BinaryQuantizer({ dimensions: 64 })
    const vector = randomVector(64)
    const binary = bq.binarize(vector)

    const distance = bq.hammingDistance(binary, binary)

    expect(distance).toBe(0)
  })

  it('hamming distance is symmetric', async () => {
    const { BinaryQuantizer } = await import('../quantization')

    const bq = new BinaryQuantizer({ dimensions: 64 })
    const v1 = randomVector(64)
    const v2 = randomVector(64)
    const b1 = bq.binarize(v1)
    const b2 = bq.binarize(v2)

    expect(bq.hammingDistance(b1, b2)).toBe(bq.hammingDistance(b2, b1))
  })

  it('uses popcount for efficiency', async () => {
    const { BinaryQuantizer } = await import('../quantization')

    const bq = new BinaryQuantizer({ dimensions: 1024 })
    const vectors = Array.from({ length: 1000 }, () => randomVector(1024))
    const binaries = vectors.map(v => bq.binarize(v))

    const query = randomVector(1024)
    const queryBinary = bq.binarize(query)

    // Should compute 1000 hamming distances quickly
    const start = performance.now()
    for (const b of binaries) {
      bq.hammingDistance(queryBinary, b)
    }
    const elapsed = performance.now() - start

    // 1000 hamming distances on 1024-bit vectors should be < 10ms with popcount
    expect(elapsed).toBeLessThan(100)
  })
})

describe('Binary Quantization - Recall', () => {
  it('achieves expected recall on random data', async () => {
    const { BinaryQuantizer } = await import('../quantization')

    const bq = new BinaryQuantizer({ dimensions: 128 })
    const index = bq.createIndex()

    // Insert 1000 vectors
    const vectors = new Map<string, Float32Array>()
    for (let i = 0; i < 1000; i++) {
      const v = seededVector(128, i)
      vectors.set(`vec-${i}`, v)
      index.insert(`vec-${i}`, v)
    }

    // Run queries and measure recall
    let totalRecall = 0
    const numQueries = 20

    for (let q = 0; q < numQueries; q++) {
      const query = seededVector(128, q + 10000)

      // Binary search results
      const binaryResults = index.search(query, { k: 10 })

      // Ground truth (brute force cosine)
      const groundTruth = Array.from(vectors.entries())
        .map(([id, v]) => ({ id, score: cosineSimilarity(query, v) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)

      const truthIds = new Set(groundTruth.map(r => r.id))
      const hits = binaryResults.filter(r => truthIds.has(r.id)).length
      totalRecall += hits / 10
    }

    const avgRecall = totalRecall / numQueries
    // Binary quantization trades accuracy for speed
    // Typical recall@10 should be > 40% for normalized vectors
    expect(avgRecall).toBeGreaterThan(0.4)
  })

  it('works as first-pass filter with reranking', async () => {
    const { BinaryQuantizer } = await import('../quantization')

    const bq = new BinaryQuantizer({ dimensions: 128 })

    // Store both binary codes and original vectors
    const binaries: Array<{ id: string; binary: Uint8Array; vector: Float32Array }> = []

    for (let i = 0; i < 1000; i++) {
      const v = seededVector(128, i)
      binaries.push({
        id: `vec-${i}`,
        binary: bq.binarize(v),
        vector: v,
      })
    }

    const query = seededVector(128, 42)
    const queryBinary = bq.binarize(query)

    // First pass: get top 100 by hamming distance
    const candidates = binaries
      .map(b => ({ ...b, hamming: bq.hammingDistance(queryBinary, b.binary) }))
      .sort((a, b) => a.hamming - b.hamming)
      .slice(0, 100)

    // Rerank by true cosine similarity
    const reranked = candidates
      .map(c => ({ id: c.id, score: cosineSimilarity(query, c.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)

    // Ground truth
    const groundTruth = binaries
      .map(b => ({ id: b.id, score: cosineSimilarity(query, b.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)

    // Reranking from 100 candidates should give high recall
    const truthIds = new Set(groundTruth.map(r => r.id))
    const recall = reranked.filter(r => truthIds.has(r.id)).length / 10

    expect(recall).toBeGreaterThan(0.7) // Should get 70%+ recall with reranking
  })
})

// ============================================================================
// SERIALIZATION (Not yet implemented)
// ============================================================================

describe('Product Quantization - Serialization', () => {
  it('serializes trained PQ to binary', async () => {
    const pq = new ProductQuantizer({
      dimensions: 64,
      numSubvectors: 8,
      numCentroids: 256,
      trainingIterations: 10,
    })

    const trainingVectors = generateTrainingVectors(3000, 64)
    await pq.train(trainingVectors)

    // Serialize should return ArrayBuffer containing codebooks
    const serialized = pq.serialize()

    expect(serialized).toBeInstanceOf(ArrayBuffer)
    expect(serialized.byteLength).toBeGreaterThan(0)

    // Size should be roughly: numSubvectors * numCentroids * subvectorDim * 4 bytes
    // = 8 * 256 * 8 * 4 = 65536 bytes + header
    expect(serialized.byteLength).toBeGreaterThanOrEqual(65536)
  })

  it('deserializes PQ from binary', async () => {
    const pq = new ProductQuantizer({
      dimensions: 64,
      numSubvectors: 8,
      numCentroids: 256,
      trainingIterations: 10,
    })

    const trainingVectors = generateTrainingVectors(3000, 64)
    await pq.train(trainingVectors)

    const serialized = pq.serialize()
    const restored = ProductQuantizer.deserialize(serialized)

    expect(restored.isTrained()).toBe(true)
    expect(restored.numSubvectors()).toBe(8)
    expect(restored.numCentroids()).toBe(256)
  })

  it('preserves encoding after serialization', async () => {
    const pq = new ProductQuantizer({
      dimensions: 64,
      numSubvectors: 8,
      numCentroids: 256,
      trainingIterations: 10,
    })

    const trainingVectors = generateTrainingVectors(3000, 64)
    await pq.train(trainingVectors)

    const testVector = seededVector(64, 12345)
    const originalCodes = pq.encode(testVector)

    const serialized = pq.serialize()
    const restored = ProductQuantizer.deserialize(serialized)
    const restoredCodes = restored.encode(testVector)

    expect(restoredCodes).toEqual(originalCodes)
  })

  it('exports codebook for inspection', async () => {
    const pq = new ProductQuantizer({
      dimensions: 32,
      numSubvectors: 4,
      numCentroids: 16,
      trainingIterations: 10,
    })

    const trainingVectors = generateTrainingVectors(200, 32)
    await pq.train(trainingVectors)

    const codebook = pq.getCodebook()

    expect(codebook).toBeDefined()
    expect(codebook.length).toBe(4) // numSubvectors
    codebook.forEach((subCodebook) => {
      expect(subCodebook.length).toBe(16) // numCentroids
      subCodebook.forEach((centroid) => {
        expect(centroid).toBeInstanceOf(Float32Array)
        expect(centroid.length).toBe(8) // subvectorDim = 32/4
      })
    })
  })
})

describe('Scalar Quantization - Serialization', () => {
  it('serializes trained SQ to binary', async () => {
    const sq = new ScalarQuantizer({
      dimensions: 64,
      bits: 8,
    })

    const trainingVectors = generateTrainingVectors(500, 64)
    await sq.train(trainingVectors)

    const serialized = sq.serialize()

    expect(serialized).toBeInstanceOf(ArrayBuffer)
    // Should contain mins and scales (2 * dimensions * 4 bytes) + header
    expect(serialized.byteLength).toBeGreaterThanOrEqual(64 * 4 * 2)
  })

  it('deserializes SQ from binary', async () => {
    const sq = new ScalarQuantizer({
      dimensions: 64,
      bits: 8,
    })

    const trainingVectors = generateTrainingVectors(500, 64)
    await sq.train(trainingVectors)

    const serialized = sq.serialize()
    const restored = ScalarQuantizer.deserialize(serialized)

    expect(restored.isTrained()).toBe(true)
  })

  it('preserves quantization after serialization', async () => {
    const sq = new ScalarQuantizer({
      dimensions: 64,
      bits: 8,
    })

    const trainingVectors = generateTrainingVectors(500, 64)
    await sq.train(trainingVectors)

    const testVector = seededVector(64, 12345)
    const originalQuantized = sq.quantize(testVector)

    const serialized = sq.serialize()
    const restored = ScalarQuantizer.deserialize(serialized)
    const restoredQuantized = restored.quantize(testVector)

    expect(restoredQuantized).toEqual(originalQuantized)
  })

  it('exports min/max bounds for inspection', async () => {
    const sq = new ScalarQuantizer({
      dimensions: 64,
      bits: 8,
    })

    const trainingVectors = generateTrainingVectors(500, 64)
    await sq.train(trainingVectors)

    const bounds = sq.getBounds()

    expect(bounds).toBeDefined()
    expect(bounds.mins).toBeInstanceOf(Float32Array)
    expect(bounds.maxs).toBeInstanceOf(Float32Array)
    expect(bounds.mins.length).toBe(64)
    expect(bounds.maxs.length).toBe(64)

    // Maxs should be >= mins
    for (let i = 0; i < 64; i++) {
      expect(bounds.maxs[i]).toBeGreaterThanOrEqual(bounds.mins[i])
    }
  })
})

// ============================================================================
// EDGE CASES
// ============================================================================

describe('Quantization Edge Cases', () => {
  it('handles zero vectors', async () => {
    const pq = new ProductQuantizer({
      dimensions: 32,
      numSubvectors: 4,
      numCentroids: 16,
    })

    // Create training data with some zero vectors
    const trainingVectors = [
      ...generateTrainingVectors(200, 32),
      new Float32Array(32), // Zero vector
      new Float32Array(32), // Another zero vector
    ]

    await pq.train(trainingVectors)

    const zeroVector = new Float32Array(32)
    const codes = pq.encode(zeroVector)

    expect(codes).toBeInstanceOf(Uint8Array)
    expect(codes.length).toBe(4)
  })

  it('handles constant vectors', async () => {
    const sq = new ScalarQuantizer({
      dimensions: 32,
      bits: 8,
    })

    // Vector where all dimensions are the same
    const constantVector = new Float32Array(32).fill(0.5)

    // Train with some variety
    const trainingVectors = generateTrainingVectors(100, 32)
    await sq.train(trainingVectors)

    const quantized = sq.quantize(constantVector)

    expect(quantized).toBeInstanceOf(Int8Array)
    expect(quantized.length).toBe(32)
  })

  it('handles extreme value vectors', async () => {
    const sq = new ScalarQuantizer({
      dimensions: 4,
      bits: 8,
    })

    const trainingVectors = [
      new Float32Array([-100, -100, -100, -100]),
      new Float32Array([100, 100, 100, 100]),
      new Float32Array([0, 0, 0, 0]),
    ]

    await sq.train(trainingVectors)

    // Test edge values
    const extreme = new Float32Array([100, -100, 0, 50])
    const quantized = sq.quantize(extreme)

    // Should clamp to int8 range
    for (const q of quantized) {
      expect(q).toBeGreaterThanOrEqual(-128)
      expect(q).toBeLessThanOrEqual(127)
    }
  })

  it('handles single dimension vectors', () => {
    const sq = new ScalarQuantizer({
      dimensions: 1,
      bits: 8,
    })

    const vector = new Float32Array([0.5])
    const quantized = sq.quantize(vector)

    expect(quantized.length).toBe(1)
  })

  it('PQ handles high-dimensional vectors', { timeout: 60000 }, async () => {
    const pq = new ProductQuantizer({
      dimensions: 1536, // OpenAI embedding size
      numSubvectors: 96, // 16 dimensions per subvector
      numCentroids: 256,
      trainingIterations: 10,
    })

    const trainingVectors = generateTrainingVectors(3000, 1536)
    await pq.train(trainingVectors)

    const vector = seededVector(1536, 42)
    const codes = pq.encode(vector)

    expect(codes.length).toBe(96)
  })

  it('quantization error bounds for PQ', async () => {
    const pq = new ProductQuantizer({
      dimensions: 64,
      numSubvectors: 8,
      numCentroids: 256,
      trainingIterations: 25,
    })

    const trainingVectors = generateTrainingVectors(3000, 64)
    await pq.train(trainingVectors)

    // Compute average distortion
    let totalDistortion = 0
    const testVectors = Array.from({ length: 100 }, (_, i) =>
      seededVector(64, i + 10000)
    )

    for (const v of testVectors) {
      const codes = pq.encode(v)
      const decoded = pq.decode(codes)
      totalDistortion += l2DistanceSquared(v, decoded)
    }

    const avgDistortion = totalDistortion / testVectors.length

    // Average distortion should be bounded
    // For normalized vectors with 8 subvectors, expect distortion < 0.5
    expect(avgDistortion).toBeLessThan(0.5)
  })

  it('quantization error bounds for SQ', async () => {
    const sq = new ScalarQuantizer({
      dimensions: 64,
      bits: 8,
    })

    const trainingVectors = generateTrainingVectors(500, 64)
    await sq.train(trainingVectors)

    // Compute max per-dimension error
    let maxError = 0
    const testVectors = Array.from({ length: 100 }, (_, i) =>
      seededVector(64, i + 10000)
    )

    for (const v of testVectors) {
      const q = sq.quantize(v)
      const d = sq.dequantize(q)

      for (let i = 0; i < v.length; i++) {
        maxError = Math.max(maxError, Math.abs(v[i] - d[i]))
      }
    }

    // For 8-bit quantization, max error should be bounded by 1/256 of range
    // For normalized vectors in [-1, 1], that's about 0.008
    expect(maxError).toBeLessThan(0.05) // Allow some margin
  })
})

// ============================================================================
// BINARY QUANTIZATION - INDEX (To be implemented)
// ============================================================================

describe('Binary Quantization - Index Operations', () => {
  it('creates empty binary index', async () => {
    const { BinaryQuantizer } = await import('../quantization')

    const bq = new BinaryQuantizer({ dimensions: 64 })
    const index = bq.createIndex()

    expect(index.size()).toBe(0)
  })

  it('inserts and retrieves vectors', async () => {
    const { BinaryQuantizer } = await import('../quantization')

    const bq = new BinaryQuantizer({ dimensions: 64 })
    const index = bq.createIndex()

    for (let i = 0; i < 100; i++) {
      index.insert(`vec-${i}`, seededVector(64, i))
    }

    expect(index.size()).toBe(100)
  })

  it('searches index by hamming distance', async () => {
    const { BinaryQuantizer } = await import('../quantization')

    const bq = new BinaryQuantizer({ dimensions: 64 })
    const index = bq.createIndex()

    for (let i = 0; i < 100; i++) {
      index.insert(`vec-${i}`, seededVector(64, i))
    }

    const query = seededVector(64, 42)
    const results = index.search(query, { k: 10 })

    expect(results).toHaveLength(10)
    // Query vector should be in top results
    const ids = results.map((r) => r.id)
    expect(ids).toContain('vec-42')
  })

  it('reports memory usage for binary index', async () => {
    const { BinaryQuantizer } = await import('../quantization')

    const bq = new BinaryQuantizer({ dimensions: 128 })
    const index = bq.createIndex()

    for (let i = 0; i < 1000; i++) {
      index.insert(`vec-${i}`, seededVector(128, i))
    }

    const memory = index.memoryUsage()

    // Binary: 1000 vectors * 16 bytes (128 bits) = 16000 bytes
    expect(memory).toBeGreaterThanOrEqual(16000)
    // Should be much less than full float32 storage
    const fullMemory = 1000 * 128 * 4 // 512000 bytes
    expect(memory).toBeLessThan(fullMemory / 10) // At least 10x compression
  })
})

// ============================================================================
// MULTI-BIT SCALAR QUANTIZATION (To be implemented)
// ============================================================================

describe('Scalar Quantization - Multi-bit Variants', () => {
  it('supports 4-bit quantization (int4)', async () => {
    const sq = new ScalarQuantizer({
      dimensions: 32,
      bits: 4,
    })

    const trainingVectors = generateTrainingVectors(100, 32)
    await sq.train(trainingVectors)

    const vector = seededVector(32, 42)
    const quantized = sq.quantize(vector)

    // 4-bit values are packed, so output is half the size
    // 32 values * 4 bits = 128 bits = 16 bytes
    expect(quantized.length).toBe(16)
  })

  it('4-bit has higher error but better compression', async () => {
    const sq4 = new ScalarQuantizer({ dimensions: 64, bits: 4 })
    const sq8 = new ScalarQuantizer({ dimensions: 64, bits: 8 })

    const trainingVectors = generateTrainingVectors(500, 64)
    await sq4.train(trainingVectors)
    await sq8.train(trainingVectors)

    const testVectors = Array.from({ length: 50 }, (_, i) =>
      seededVector(64, i + 10000)
    )

    // Compute MSE for both
    let mse4 = 0
    let mse8 = 0

    for (const v of testVectors) {
      const q4 = sq4.quantize(v)
      const d4 = sq4.dequantize(q4)
      mse4 += l2DistanceSquared(v, d4)

      const q8 = sq8.quantize(v)
      const d8 = sq8.dequantize(q8)
      mse8 += l2DistanceSquared(v, d8)
    }

    mse4 /= testVectors.length
    mse8 /= testVectors.length

    // 4-bit should have higher error
    expect(mse4).toBeGreaterThan(mse8)
    // But both should still preserve most information
    expect(mse4).toBeLessThan(1.0)
    expect(mse8).toBeLessThan(0.1)
  })

  it('supports 16-bit quantization (int16)', async () => {
    const sq = new ScalarQuantizer({
      dimensions: 32,
      bits: 16,
    })

    const trainingVectors = generateTrainingVectors(100, 32)
    await sq.train(trainingVectors)

    const vector = seededVector(32, 42)
    const quantized = sq.quantize(vector)

    // 16-bit: 32 values * 2 bytes = 64 bytes
    expect(quantized.length).toBe(64)
  })

  it('16-bit achieves near-lossless reconstruction', async () => {
    const sq = new ScalarQuantizer({
      dimensions: 64,
      bits: 16,
    })

    const trainingVectors = generateTrainingVectors(500, 64)
    await sq.train(trainingVectors)

    const testVectors = Array.from({ length: 50 }, (_, i) =>
      seededVector(64, i + 10000)
    )

    let maxError = 0
    for (const v of testVectors) {
      const q = sq.quantize(v)
      const d = sq.dequantize(q)

      for (let i = 0; i < v.length; i++) {
        maxError = Math.max(maxError, Math.abs(v[i] - d[i]))
      }
    }

    // 16-bit should have very low error (1/65536 of range)
    expect(maxError).toBeLessThan(0.001)
  })
})

// ============================================================================
// OPTIMIZED PRODUCT QUANTIZATION (To be implemented)
// ============================================================================

describe('Optimized Product Quantization', () => {
  it('OPQ rotates vectors before quantization', async () => {
    // Optimized Product Quantization learns a rotation matrix
    // that minimizes quantization error
    const { OptimizedProductQuantizer } = await import('../quantization')

    const opq = new OptimizedProductQuantizer({
      dimensions: 64,
      numSubvectors: 8,
      numCentroids: 256,
      trainingIterations: 10,
    })

    const trainingVectors = generateTrainingVectors(3000, 64)
    await opq.train(trainingVectors)

    expect(opq.isTrained()).toBe(true)
    expect(opq.getRotationMatrix()).toBeInstanceOf(Float32Array)
    // Rotation matrix should be orthogonal (64x64)
    expect(opq.getRotationMatrix().length).toBe(64 * 64)
  })

  it('OPQ achieves lower distortion than standard PQ', async () => {
    const { OptimizedProductQuantizer, ProductQuantizer } = await import('../quantization')

    const trainingVectors = generateTrainingVectors(3000, 64)
    const testVectors = Array.from({ length: 100 }, (_, i) =>
      seededVector(64, i + 10000)
    )

    // Train standard PQ
    const pq = new ProductQuantizer({
      dimensions: 64,
      numSubvectors: 8,
      numCentroids: 256,
      trainingIterations: 15,
    })
    await pq.train(trainingVectors)

    // Train OPQ
    const opq = new OptimizedProductQuantizer({
      dimensions: 64,
      numSubvectors: 8,
      numCentroids: 256,
      trainingIterations: 15,
    })
    await opq.train(trainingVectors)

    // Compute distortions
    let pqDistortion = 0
    let opqDistortion = 0

    for (const v of testVectors) {
      const pqCodes = pq.encode(v)
      const pqDecoded = pq.decode(pqCodes)
      pqDistortion += l2DistanceSquared(v, pqDecoded)

      const opqCodes = opq.encode(v)
      const opqDecoded = opq.decode(opqCodes)
      opqDistortion += l2DistanceSquared(v, opqDecoded)
    }

    pqDistortion /= testVectors.length
    opqDistortion /= testVectors.length

    // OPQ should achieve lower distortion
    expect(opqDistortion).toBeLessThan(pqDistortion)
  })
})

// ============================================================================
// ADDITIVE QUANTIZATION (To be implemented)
// ============================================================================

describe('Additive Quantization', () => {
  it('AQ uses multiple codebooks additively', async () => {
    // Additive Quantization approximates vectors as a sum of codewords
    // from multiple codebooks, achieving better accuracy than PQ
    const { AdditiveQuantizer } = await import('../quantization')

    const aq = new AdditiveQuantizer({
      dimensions: 64,
      numCodebooks: 4, // Number of codebooks (M)
      numCentroids: 256, // Centroids per codebook
      trainingIterations: 10,
    })

    const trainingVectors = generateTrainingVectors(3000, 64)
    await aq.train(trainingVectors)

    expect(aq.isTrained()).toBe(true)
  })

  it('AQ encodes to M codes like PQ', async () => {
    const { AdditiveQuantizer } = await import('../quantization')

    const aq = new AdditiveQuantizer({
      dimensions: 64,
      numCodebooks: 4,
      numCentroids: 256,
    })

    const trainingVectors = generateTrainingVectors(3000, 64)
    await aq.train(trainingVectors)

    const vector = seededVector(64, 42)
    const codes = aq.encode(vector)

    expect(codes).toBeInstanceOf(Uint8Array)
    expect(codes.length).toBe(4) // numCodebooks
  })

  it('AQ decodes by summing codewords', async () => {
    const { AdditiveQuantizer } = await import('../quantization')

    const aq = new AdditiveQuantizer({
      dimensions: 64,
      numCodebooks: 4,
      numCentroids: 256,
    })

    const trainingVectors = generateTrainingVectors(3000, 64)
    await aq.train(trainingVectors)

    const original = seededVector(64, 42)
    const codes = aq.encode(original)
    const decoded = aq.decode(codes)

    expect(decoded).toBeInstanceOf(Float32Array)
    expect(decoded.length).toBe(64)

    // Decoded should be close to original
    const similarity = cosineSimilarity(original, decoded)
    expect(similarity).toBeGreaterThan(0.8)
  })
})

// ============================================================================
// RESIDUAL VECTOR QUANTIZATION (To be implemented)
// ============================================================================

describe('Residual Vector Quantization', () => {
  it('RVQ quantizes residuals iteratively', async () => {
    // RVQ applies coarse quantization, then quantizes the residual
    // This is used in multi-stage systems like IVF+PQ
    const { ResidualVectorQuantizer } = await import('../quantization')

    const rvq = new ResidualVectorQuantizer({
      dimensions: 64,
      numStages: 3, // Number of residual stages
      numCentroids: 256, // Centroids per stage
    })

    const trainingVectors = generateTrainingVectors(3000, 64)
    await rvq.train(trainingVectors)

    expect(rvq.isTrained()).toBe(true)
    expect(rvq.numStages()).toBe(3)
  })

  it('RVQ produces codes for each stage', async () => {
    const { ResidualVectorQuantizer } = await import('../quantization')

    const rvq = new ResidualVectorQuantizer({
      dimensions: 64,
      numStages: 3,
      numCentroids: 256,
    })

    const trainingVectors = generateTrainingVectors(3000, 64)
    await rvq.train(trainingVectors)

    const vector = seededVector(64, 42)
    const codes = rvq.encode(vector)

    // Should produce one code per stage
    expect(codes.length).toBe(3)
  })

  it('RVQ achieves lower distortion with more stages', async () => {
    const { ResidualVectorQuantizer } = await import('../quantization')

    const trainingVectors = generateTrainingVectors(3000, 64)
    const testVector = seededVector(64, 42)

    const distortions: number[] = []

    for (const numStages of [1, 2, 3, 4]) {
      const rvq = new ResidualVectorQuantizer({
        dimensions: 64,
        numStages,
        numCentroids: 64, // Fewer centroids for speed
      })

      await rvq.train(trainingVectors)

      const codes = rvq.encode(testVector)
      const decoded = rvq.decode(codes)
      const distortion = l2DistanceSquared(testVector, decoded)

      distortions.push(distortion)
    }

    // Each additional stage should reduce distortion
    for (let i = 1; i < distortions.length; i++) {
      expect(distortions[i]).toBeLessThanOrEqual(distortions[i - 1])
    }
  })
})

// ============================================================================
// CONCURRENT / BATCH OPERATIONS
// ============================================================================

describe('Concurrent Encoding Operations', () => {
  it('supports parallel encoding without corruption', async () => {
    const pq = new ProductQuantizer({
      dimensions: 64,
      numSubvectors: 8,
      numCentroids: 256,
      trainingIterations: 10,
    })

    const trainingVectors = generateTrainingVectors(3000, 64)
    await pq.train(trainingVectors)

    // Encode same vector multiple times concurrently
    const vector = seededVector(64, 42)
    const encodingPromises = Array.from({ length: 100 }, async () => {
      return pq.encode(vector)
    })

    const results = await Promise.all(encodingPromises)

    // All results should be identical
    const expected = results[0]
    for (const result of results) {
      expect(result).toEqual(expected)
    }
  })

  it('batch search returns consistent results', async () => {
    const pq = new ProductQuantizer({
      dimensions: 64,
      numSubvectors: 8,
      numCentroids: 256,
      trainingIterations: 10,
    })

    const trainingVectors = generateTrainingVectors(3000, 64)
    await pq.train(trainingVectors)

    const index = pq.createIndex()

    // Insert vectors
    for (let i = 0; i < 500; i++) {
      index.insert(`vec-${i}`, seededVector(64, i))
    }

    // Run same query multiple times
    const query = seededVector(64, 42)
    const results1 = index.search(query, { k: 10 })
    const results2 = index.search(query, { k: 10 })
    const results3 = index.search(query, { k: 10 })

    // Results should be identical
    expect(results1).toEqual(results2)
    expect(results2).toEqual(results3)
  })
})

// ============================================================================
// MEMORY EFFICIENCY
// ============================================================================

describe('Memory Efficiency Metrics', () => {
  it('PQ achieves expected compression ratio', async () => {
    const pq = new ProductQuantizer({
      dimensions: 768, // BERT embedding size
      numSubvectors: 48, // 16 dimensions per subvector
      numCentroids: 256,
      trainingIterations: 5,
    })

    const trainingVectors = generateTrainingVectors(3000, 768)
    await pq.train(trainingVectors)

    const index = pq.createIndex()

    // Insert 10000 vectors
    for (let i = 0; i < 10000; i++) {
      index.insert(`vec-${i}`, seededVector(768, i))
    }

    const memory = index.memoryUsage()
    const fullSize = 10000 * 768 * 4 // Full float32

    // Expected: 48 bytes per vector (codes) + ~20 bytes per ID
    // = ~68 bytes vs 3072 bytes = ~45x compression
    const compressionRatio = fullSize / memory
    expect(compressionRatio).toBeGreaterThan(30) // At least 30x compression
  })

  it('Binary quantization achieves 32x compression', async () => {
    const { BinaryQuantizer } = await import('../quantization')

    const bq = new BinaryQuantizer({ dimensions: 1024 })
    const index = bq.createIndex()

    for (let i = 0; i < 10000; i++) {
      index.insert(`vec-${i}`, seededVector(1024, i))
    }

    const memory = index.memoryUsage()
    const fullSize = 10000 * 1024 * 4 // Full float32

    // Binary: 128 bytes per vector (1024 bits) + ID overhead
    // vs 4096 bytes = 32x compression (minus overhead)
    const compressionRatio = fullSize / memory
    expect(compressionRatio).toBeGreaterThan(20) // At least 20x accounting for overhead
  })
})

// ============================================================================
// QUANTIZER FACTORY (To be implemented)
// ============================================================================

describe('Quantizer Factory', () => {
  it('creates quantizer by name', async () => {
    const { createQuantizer } = await import('../quantization')

    const pq = createQuantizer('pq', {
      dimensions: 64,
      numSubvectors: 8,
      numCentroids: 256,
    })

    expect(pq).toBeDefined()
    expect(pq.numSubvectors()).toBe(8)
  })

  it('creates binary quantizer by name', async () => {
    const { createQuantizer } = await import('../quantization')

    const bq = createQuantizer('binary', { dimensions: 64 })

    expect(bq).toBeDefined()
    const binary = bq.binarize(randomVector(64))
    expect(binary).toBeInstanceOf(Uint8Array)
  })

  it('creates scalar quantizer by name', async () => {
    const { createQuantizer } = await import('../quantization')

    const sq = createQuantizer('scalar', { dimensions: 64, bits: 8 })

    expect(sq).toBeDefined()
    const quantized = sq.quantize(randomVector(64))
    expect(quantized).toBeInstanceOf(Int8Array)
  })

  it('throws for unknown quantizer type', async () => {
    const { createQuantizer } = await import('../quantization')

    expect(() => createQuantizer('unknown' as any, { dimensions: 64 })).toThrow(
      /unknown quantizer type/i
    )
  })
})
