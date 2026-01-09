/**
 * Matryoshka Embedding Tests
 *
 * TDD tests for Matryoshka embedding handler which supports variable-length
 * prefixes of embeddings. Named after Russian nesting dolls, Matryoshka embeddings
 * are trained so that the first N dimensions of a longer embedding are a valid
 * embedding on their own.
 *
 * This enables adaptive precision:
 * - Use shorter prefixes for coarse/fast search
 * - Use full length for high precision
 * - Dynamically adjust based on latency vs accuracy tradeoffs
 *
 * Key insight: The semantic information is concentrated in the early dimensions,
 * allowing truncation without significant information loss.
 *
 * @see https://arxiv.org/abs/2205.13147 - Matryoshka Representation Learning
 * @module tests/vector/matryoshka.test
 */

import { describe, it, expect, beforeEach } from 'vitest'

// ============================================================================
// MODULE IMPORTS (will fail until implementation exists)
// ============================================================================

// These imports will fail until the module is implemented
// This is the expected behavior for TDD - tests define the API contract

let truncateEmbedding: (
  embedding: Float32Array,
  targetDimension: number,
  options?: { normalize?: boolean }
) => Float32Array

let MatryoshkaHandler: new (options: {
  originalDimension: number
  supportedDimensions?: number[]
}) => {
  originalDimension: number
  supportedDimensions: number[]
  truncate: (embedding: Float32Array, targetDimension: number) => Float32Array
  truncateBatch: (embeddings: Float32Array[], targetDimension: number) => Float32Array[]
  normalize: (embedding: Float32Array) => Float32Array
  similarity: (a: Float32Array, b: Float32Array) => number
  crossDimensionSimilarity: (a: Float32Array, b: Float32Array) => number
  getStorageSavings: (targetDimension: number) => StorageSavings
  validateDimension: (dimension: number) => boolean
  getSupportedDimensions: () => number[]
}

let isValidMatryoshkaDimension: (
  dimension: number,
  originalDimension: number
) => boolean

let computeStorageSavings: (
  originalDimension: number,
  targetDimension: number
) => StorageSavings

let batchTruncate: (
  embeddings: Float32Array[],
  targetDimension: number,
  options?: { normalize?: boolean; parallel?: boolean }
) => Float32Array[]

let truncateAndQuantize: (
  embedding: Float32Array,
  targetDimension: number,
  quantizationBits: number
) => Uint8Array

interface StorageSavings {
  originalBytes: number
  truncatedBytes: number
  savedBytes: number
  compressionRatio: number
  savingsPercent: number
}

// Try to import the module - will fail until implemented
try {
  const mod = await import('../../db/core/vector/matryoshka')
  truncateEmbedding = mod.truncateEmbedding
  MatryoshkaHandler = mod.MatryoshkaHandler
  isValidMatryoshkaDimension = mod.isValidMatryoshkaDimension
  computeStorageSavings = mod.computeStorageSavings
  batchTruncate = mod.batchTruncate
  truncateAndQuantize = mod.truncateAndQuantize
} catch {
  // Module not yet implemented - tests will fail with clear messages
  truncateEmbedding = () => {
    throw new Error('Module not implemented: truncateEmbedding')
  }
  MatryoshkaHandler = class {
    constructor() {
      throw new Error('Module not implemented: MatryoshkaHandler')
    }
  } as any
  isValidMatryoshkaDimension = () => {
    throw new Error('Module not implemented: isValidMatryoshkaDimension')
  }
  computeStorageSavings = () => {
    throw new Error('Module not implemented: computeStorageSavings')
  }
  batchTruncate = () => {
    throw new Error('Module not implemented: batchTruncate')
  }
  truncateAndQuantize = () => {
    throw new Error('Module not implemented: truncateAndQuantize')
  }
}

// ============================================================================
// TEST UTILITIES
// ============================================================================

/**
 * Create a random float vector with values between -1 and 1
 * Uses seeded PRNG for reproducibility
 */
function randomVector(dims: number, seed = 42): Float32Array {
  const vector = new Float32Array(dims)
  let state = seed
  for (let i = 0; i < dims; i++) {
    // Simple LCG for reproducible random values
    state = (state * 1103515245 + 12345) & 0x7fffffff
    vector[i] = (state / 0x7fffffff) * 2 - 1 // Range: -1 to 1
  }
  return vector
}

/**
 * Create a unit vector (normalized to length 1)
 */
function unitVector(dims: number, seed = 42): Float32Array {
  const vector = randomVector(dims, seed)
  let norm = 0
  for (let i = 0; i < dims; i++) {
    norm += vector[i] * vector[i]
  }
  norm = Math.sqrt(norm)
  for (let i = 0; i < dims; i++) {
    vector[i] /= norm
  }
  return vector
}

/**
 * Compute L2 norm of a vector
 */
function l2Norm(v: Float32Array): number {
  let sum = 0
  for (let i = 0; i < v.length; i++) {
    sum += v[i] * v[i]
  }
  return Math.sqrt(sum)
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
  // Include remaining dimensions in norms for proper normalization
  for (let i = minLen; i < a.length; i++) {
    normA += a[i] * a[i]
  }
  for (let i = minLen; i < b.length; i++) {
    normB += b[i] * b[i]
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * Compute cosine similarity between two same-length vectors
 */
function cosineSim(a: Float32Array, b: Float32Array): number {
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
 * Verify vector is normalized (unit length)
 */
function isNormalized(v: Float32Array, tolerance = 1e-5): boolean {
  const norm = l2Norm(v)
  return Math.abs(norm - 1.0) < tolerance
}

// ============================================================================
// TESTS: BASIC TRUNCATION
// ============================================================================

describe('Matryoshka Embeddings', () => {
  describe('truncateEmbedding - truncate to specified dimension', () => {
    it('should truncate embedding to specified dimension', () => {
      // Create a 1536-dimensional embedding (OpenAI text-embedding-3-large)
      const embedding = randomVector(1536, 42)

      // Truncate to 256 dimensions
      const truncated = truncateEmbedding(embedding, 256)

      // Verify truncation
      expect(truncated).toBeInstanceOf(Float32Array)
      expect(truncated.length).toBe(256)

      // Verify it's the first 256 dimensions (prefix)
      for (let i = 0; i < 256; i++) {
        expect(truncated[i]).toBe(embedding[i])
      }
    })

    it('should preserve first N dimensions exactly', () => {
      const embedding = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8])

      const truncated = truncateEmbedding(embedding, 4)

      expect(truncated).toEqual(new Float32Array([0.1, 0.2, 0.3, 0.4]))
    })

    it('should handle truncation to same dimension (no-op)', () => {
      const embedding = randomVector(768, 42)

      const truncated = truncateEmbedding(embedding, 768)

      expect(truncated.length).toBe(768)
      // Should be same values (but may be a copy)
      for (let i = 0; i < 768; i++) {
        expect(truncated[i]).toBe(embedding[i])
      }
    })

    it('should throw error when target dimension exceeds original', () => {
      const embedding = randomVector(512, 42)

      expect(() => truncateEmbedding(embedding, 1024)).toThrow(/dimension.*exceed/i)
    })

    it('should throw error for non-positive target dimension', () => {
      const embedding = randomVector(512, 42)

      expect(() => truncateEmbedding(embedding, 0)).toThrow(/positive/i)
      expect(() => truncateEmbedding(embedding, -1)).toThrow(/positive/i)
    })
  })

  // ============================================================================
  // TESTS: COMMON PREFIX LENGTHS
  // ============================================================================

  describe('common prefix lengths support', () => {
    it('should support common prefix lengths (64, 128, 256, 384, 512, 768, 1024, 1536)', () => {
      const commonLengths = [64, 128, 256, 384, 512, 768, 1024, 1536]
      const embedding = randomVector(3072, 42) // Large embedding to test all sizes

      for (const length of commonLengths) {
        const truncated = truncateEmbedding(embedding, length)

        expect(truncated.length).toBe(length)
        expect(truncated).toBeInstanceOf(Float32Array)

        // Verify prefix preservation
        for (let i = 0; i < length; i++) {
          expect(truncated[i]).toBe(embedding[i])
        }
      }
    })

    it('should support OpenAI text-embedding-3 dimensions (256, 512, 1024, 1536, 3072)', () => {
      // OpenAI text-embedding-3-small: up to 1536
      // OpenAI text-embedding-3-large: up to 3072
      const openAIDimensions = [256, 512, 1024, 1536, 3072]
      const embedding = randomVector(3072, 42)

      for (const dim of openAIDimensions) {
        const truncated = truncateEmbedding(embedding, dim)

        expect(truncated.length).toBe(dim)
      }
    })

    it('should support Cohere embed-v3 dimensions (256, 384, 512, 768, 1024)', () => {
      const cohereDimensions = [256, 384, 512, 768, 1024]
      const embedding = randomVector(1024, 42)

      for (const dim of cohereDimensions) {
        const truncated = truncateEmbedding(embedding, dim)

        expect(truncated.length).toBe(dim)
      }
    })
  })

  // ============================================================================
  // TESTS: SIMILARITY RANKING PRESERVATION
  // ============================================================================

  describe('similarity ranking preservation', () => {
    it('should preserve similarity ranking with shorter prefixes', () => {
      // Create a query and several candidate embeddings
      const query = unitVector(1536, 1)
      const candidates = [
        unitVector(1536, 10),
        unitVector(1536, 20),
        unitVector(1536, 30),
        unitVector(1536, 40),
        unitVector(1536, 50),
      ]

      // Make some candidates more similar to query
      for (let i = 0; i < 768; i++) {
        candidates[0][i] = query[i] * 0.95 + candidates[0][i] * 0.05 // Most similar
        candidates[1][i] = query[i] * 0.7 + candidates[1][i] * 0.3 // Second most similar
      }
      // Re-normalize
      candidates.forEach((c) => {
        const norm = l2Norm(c)
        for (let i = 0; i < c.length; i++) c[i] /= norm
      })

      // Compute full-dimension similarities
      const fullSimilarities = candidates.map((c) => cosineSim(query, c))

      // Get ranking at full dimension
      const fullRanking = fullSimilarities
        .map((sim, idx) => ({ sim, idx }))
        .sort((a, b) => b.sim - a.sim)
        .map((r) => r.idx)

      // Test at various truncation levels
      const truncationLevels = [256, 512, 768, 1024]

      for (const dim of truncationLevels) {
        const truncatedQuery = truncateEmbedding(query, dim, { normalize: true })
        const truncatedCandidates = candidates.map((c) =>
          truncateEmbedding(c, dim, { normalize: true })
        )

        const truncatedSimilarities = truncatedCandidates.map((c) =>
          cosineSim(truncatedQuery, c)
        )

        // Get ranking at truncated dimension
        const truncatedRanking = truncatedSimilarities
          .map((sim, idx) => ({ sim, idx }))
          .sort((a, b) => b.sim - a.sim)
          .map((r) => r.idx)

        // Top result should remain the same (with high probability)
        // The most similar vectors should remain in top positions
        expect(truncatedRanking[0]).toBe(fullRanking[0])

        // Kendall tau or Spearman correlation could be computed here
        // For now, verify top-2 overlap
        const top2Full = new Set(fullRanking.slice(0, 2))
        const top2Truncated = new Set(truncatedRanking.slice(0, 2))
        const overlap = [...top2Full].filter((x) => top2Truncated.has(x)).length
        expect(overlap).toBeGreaterThanOrEqual(1)
      }
    })

    it('should maintain high recall at reduced dimensions', () => {
      const numVectors = 100
      const k = 10

      // Generate random vectors
      const vectors: Float32Array[] = []
      for (let i = 0; i < numVectors; i++) {
        vectors.push(unitVector(1536, i))
      }

      const query = unitVector(1536, 999)

      // Get ground truth top-k at full dimension
      const fullSimilarities = vectors.map((v, i) => ({
        idx: i,
        sim: cosineSim(query, v),
      }))
      fullSimilarities.sort((a, b) => b.sim - a.sim)
      const groundTruth = new Set(fullSimilarities.slice(0, k).map((r) => r.idx))

      // Test recall at different dimensions
      const testDimensions = [256, 512, 768]

      for (const dim of testDimensions) {
        const truncatedQuery = truncateEmbedding(query, dim, { normalize: true })
        const truncatedVectors = vectors.map((v) =>
          truncateEmbedding(v, dim, { normalize: true })
        )

        const truncatedSimilarities = truncatedVectors.map((v, i) => ({
          idx: i,
          sim: cosineSim(truncatedQuery, v),
        }))
        truncatedSimilarities.sort((a, b) => b.sim - a.sim)
        const topKTruncated = new Set(
          truncatedSimilarities.slice(0, k).map((r) => r.idx)
        )

        // Calculate recall
        const hits = [...groundTruth].filter((x) => topKTruncated.has(x)).length
        const recall = hits / k

        // Expect reasonable recall (Matryoshka embeddings are designed to maintain this)
        // At 768 dim (50% of original), recall should be high
        // At 256 dim (16% of original), recall may be lower but still useful
        if (dim >= 768) {
          expect(recall).toBeGreaterThanOrEqual(0.7)
        } else {
          expect(recall).toBeGreaterThanOrEqual(0.4)
        }
      }
    })
  })

  // ============================================================================
  // TESTS: CROSS-DIMENSION SIMILARITY
  // ============================================================================

  describe('cross-dimension similarity', () => {
    it('should compute similarity between different length prefixes', () => {
      const handler = new MatryoshkaHandler({ originalDimension: 1536 })

      const embedding1 = unitVector(1536, 1)
      const embedding2 = unitVector(1536, 2)

      // Truncate to different dimensions
      const short1 = handler.truncate(embedding1, 256)
      const long2 = handler.truncate(embedding2, 768)

      // Should be able to compute similarity using the smaller dimension
      const similarity = handler.crossDimensionSimilarity(short1, long2)

      expect(typeof similarity).toBe('number')
      expect(similarity).toBeGreaterThanOrEqual(-1)
      expect(similarity).toBeLessThanOrEqual(1)
      expect(Number.isFinite(similarity)).toBe(true)
    })

    it('should use minimum dimension for cross-dimension similarity', () => {
      const handler = new MatryoshkaHandler({ originalDimension: 1536 })

      const embedding1 = unitVector(1536, 1)
      const embedding2 = unitVector(1536, 2)

      const dim256 = handler.truncate(embedding1, 256)
      const dim512 = handler.truncate(embedding2, 512)
      const dim256_2 = handler.truncate(embedding2, 256)

      // Similarity between 256-dim and 512-dim should use first 256 dims
      const crossSim = handler.crossDimensionSimilarity(dim256, dim512)

      // This should equal similarity between two 256-dim embeddings
      const sameDimSim = handler.similarity(dim256, dim256_2)

      expect(crossSim).toBeCloseTo(sameDimSim, 5)
    })

    it('should handle same dimension as regular similarity', () => {
      const handler = new MatryoshkaHandler({ originalDimension: 1536 })

      const embedding1 = unitVector(1536, 1)
      const embedding2 = unitVector(1536, 2)

      const trunc1 = handler.truncate(embedding1, 512)
      const trunc2 = handler.truncate(embedding2, 512)

      const crossSim = handler.crossDimensionSimilarity(trunc1, trunc2)
      const regularSim = handler.similarity(trunc1, trunc2)

      expect(crossSim).toBeCloseTo(regularSim, 5)
    })
  })

  // ============================================================================
  // TESTS: NORMALIZATION
  // ============================================================================

  describe('truncated embedding normalization', () => {
    it('should normalize truncated embeddings', () => {
      const embedding = randomVector(1536, 42)

      // Truncate with normalization
      const truncated = truncateEmbedding(embedding, 256, { normalize: true })

      expect(truncated.length).toBe(256)
      expect(isNormalized(truncated)).toBe(true)
    })

    it('should not normalize by default', () => {
      const embedding = unitVector(1536, 42) // Start with unit vector

      // Truncate without explicit normalization option
      const truncated = truncateEmbedding(embedding, 256)

      // Truncated prefix of unit vector is NOT itself a unit vector
      // (unless all the magnitude happens to be in the first 256 dims)
      // So norm should likely be != 1
      const norm = l2Norm(truncated)

      // Just verify we got the right values (prefix)
      for (let i = 0; i < 256; i++) {
        expect(truncated[i]).toBe(embedding[i])
      }
    })

    it('should provide normalize method in handler', () => {
      const handler = new MatryoshkaHandler({ originalDimension: 1536 })
      const embedding = randomVector(256, 42)

      const normalized = handler.normalize(embedding)

      expect(normalized).toBeInstanceOf(Float32Array)
      expect(normalized.length).toBe(256)
      expect(isNormalized(normalized)).toBe(true)
    })

    it('should handle already normalized vectors', () => {
      const handler = new MatryoshkaHandler({ originalDimension: 1536 })
      const embedding = unitVector(256, 42)

      expect(isNormalized(embedding)).toBe(true)

      const normalized = handler.normalize(embedding)

      expect(isNormalized(normalized)).toBe(true)
      // Values should be essentially unchanged
      for (let i = 0; i < 256; i++) {
        expect(normalized[i]).toBeCloseTo(embedding[i], 5)
      }
    })
  })

  // ============================================================================
  // TESTS: DIMENSION VALIDATION
  // ============================================================================

  describe('dimension validation', () => {
    it('should validate dimension is power of 2 or standard length', () => {
      // Powers of 2
      expect(isValidMatryoshkaDimension(64, 1536)).toBe(true)
      expect(isValidMatryoshkaDimension(128, 1536)).toBe(true)
      expect(isValidMatryoshkaDimension(256, 1536)).toBe(true)
      expect(isValidMatryoshkaDimension(512, 1536)).toBe(true)
      expect(isValidMatryoshkaDimension(1024, 1536)).toBe(true)

      // Standard model dimensions (not powers of 2)
      expect(isValidMatryoshkaDimension(384, 1536)).toBe(true) // Common in models
      expect(isValidMatryoshkaDimension(768, 1536)).toBe(true) // BERT, etc.
      expect(isValidMatryoshkaDimension(1536, 1536)).toBe(true) // OpenAI

      // Invalid: exceeds original
      expect(isValidMatryoshkaDimension(2048, 1536)).toBe(false)

      // Invalid: zero or negative
      expect(isValidMatryoshkaDimension(0, 1536)).toBe(false)
      expect(isValidMatryoshkaDimension(-64, 1536)).toBe(false)
    })

    it('should accept arbitrary dimensions within bounds when configured', () => {
      const handler = new MatryoshkaHandler({
        originalDimension: 1536,
        supportedDimensions: [100, 200, 300, 400, 500], // Custom dimensions
      })

      expect(handler.validateDimension(100)).toBe(true)
      expect(handler.validateDimension(200)).toBe(true)
      expect(handler.validateDimension(300)).toBe(true)

      // Not in supported list
      expect(handler.validateDimension(150)).toBe(false)
      expect(handler.validateDimension(256)).toBe(false)
    })

    it('should return supported dimensions list', () => {
      const handler = new MatryoshkaHandler({ originalDimension: 1536 })

      const supported = handler.getSupportedDimensions()

      expect(Array.isArray(supported)).toBe(true)
      expect(supported.length).toBeGreaterThan(0)

      // Should include common dimensions
      expect(supported).toContain(256)
      expect(supported).toContain(512)
      expect(supported).toContain(768)
      expect(supported).toContain(1024)
      expect(supported).toContain(1536)

      // Should be sorted ascending
      for (let i = 0; i < supported.length - 1; i++) {
        expect(supported[i]).toBeLessThan(supported[i + 1])
      }
    })
  })

  // ============================================================================
  // TESTS: BATCH TRUNCATION
  // ============================================================================

  describe('batch truncation', () => {
    it('should handle batch truncation efficiently', () => {
      const embeddings: Float32Array[] = []
      for (let i = 0; i < 100; i++) {
        embeddings.push(randomVector(1536, i))
      }

      const truncated = batchTruncate(embeddings, 256)

      expect(truncated).toHaveLength(100)
      truncated.forEach((t, i) => {
        expect(t).toBeInstanceOf(Float32Array)
        expect(t.length).toBe(256)

        // Verify it's the prefix
        for (let j = 0; j < 256; j++) {
          expect(t[j]).toBe(embeddings[i][j])
        }
      })
    })

    it('should support normalization in batch mode', () => {
      const embeddings: Float32Array[] = []
      for (let i = 0; i < 50; i++) {
        embeddings.push(randomVector(1536, i))
      }

      const truncated = batchTruncate(embeddings, 256, { normalize: true })

      expect(truncated).toHaveLength(50)
      truncated.forEach((t) => {
        expect(isNormalized(t)).toBe(true)
      })
    })

    it('should handle empty batch', () => {
      const truncated = batchTruncate([], 256)

      expect(truncated).toEqual([])
    })

    it('should handle single embedding batch', () => {
      const embedding = randomVector(1536, 42)
      const truncated = batchTruncate([embedding], 512)

      expect(truncated).toHaveLength(1)
      expect(truncated[0].length).toBe(512)
    })

    it('should provide batch method in handler class', () => {
      const handler = new MatryoshkaHandler({ originalDimension: 1536 })

      const embeddings: Float32Array[] = []
      for (let i = 0; i < 20; i++) {
        embeddings.push(randomVector(1536, i))
      }

      const truncated = handler.truncateBatch(embeddings, 384)

      expect(truncated).toHaveLength(20)
      truncated.forEach((t) => {
        expect(t.length).toBe(384)
      })
    })
  })

  // ============================================================================
  // TESTS: STORAGE SAVINGS
  // ============================================================================

  describe('storage savings calculation', () => {
    it('should provide storage savings calculation', () => {
      const savings = computeStorageSavings(1536, 256)

      // Float32 = 4 bytes per dimension
      expect(savings.originalBytes).toBe(1536 * 4) // 6144 bytes
      expect(savings.truncatedBytes).toBe(256 * 4) // 1024 bytes
      expect(savings.savedBytes).toBe((1536 - 256) * 4) // 5120 bytes
      expect(savings.compressionRatio).toBeCloseTo(6, 1) // 1536/256 = 6x
      expect(savings.savingsPercent).toBeCloseTo(83.33, 1) // (1 - 256/1536) * 100
    })

    it('should calculate savings for various dimension pairs', () => {
      const testCases = [
        { original: 1536, target: 768, expectedRatio: 2 },
        { original: 1536, target: 512, expectedRatio: 3 },
        { original: 1536, target: 256, expectedRatio: 6 },
        { original: 1536, target: 128, expectedRatio: 12 },
        { original: 1536, target: 64, expectedRatio: 24 },
        { original: 3072, target: 256, expectedRatio: 12 },
      ]

      for (const { original, target, expectedRatio } of testCases) {
        const savings = computeStorageSavings(original, target)

        expect(savings.compressionRatio).toBeCloseTo(expectedRatio, 1)
        expect(savings.originalBytes).toBe(original * 4)
        expect(savings.truncatedBytes).toBe(target * 4)
      }
    })

    it('should return 1x compression when no truncation', () => {
      const savings = computeStorageSavings(1536, 1536)

      expect(savings.compressionRatio).toBe(1)
      expect(savings.savedBytes).toBe(0)
      expect(savings.savingsPercent).toBe(0)
    })

    it('should provide savings via handler method', () => {
      const handler = new MatryoshkaHandler({ originalDimension: 1536 })

      const savings = handler.getStorageSavings(256)

      expect(savings.originalBytes).toBe(6144)
      expect(savings.truncatedBytes).toBe(1024)
      expect(savings.compressionRatio).toBeCloseTo(6, 1)
    })
  })

  // ============================================================================
  // TESTS: OPENAI TEXT-EMBEDDING-3 INTEGRATION
  // ============================================================================

  describe('OpenAI text-embedding-3 dimensions', () => {
    it('should support OpenAI text-embedding-3 dimensions', () => {
      // text-embedding-3-small: native 1536 dims, can request 256, 512, 1024, 1536
      // text-embedding-3-large: native 3072 dims, can request 256, 512, 1024, 1536, 3072

      const handler = new MatryoshkaHandler({
        originalDimension: 3072, // text-embedding-3-large
      })

      const embedding = randomVector(3072, 42)

      // Test all OpenAI-supported output dimensions
      const openAIDimensions = [256, 512, 1024, 1536, 3072]

      for (const dim of openAIDimensions) {
        const truncated = handler.truncate(embedding, dim)

        expect(truncated.length).toBe(dim)
        expect(handler.validateDimension(dim)).toBe(true)
      }
    })

    it('should handle text-embedding-3-small dimensions', () => {
      const handler = new MatryoshkaHandler({
        originalDimension: 1536, // text-embedding-3-small
      })

      const embedding = randomVector(1536, 42)

      // text-embedding-3-small supports these via API
      const supportedDims = [256, 512, 1024, 1536]

      for (const dim of supportedDims) {
        const truncated = handler.truncate(embedding, dim)
        expect(truncated.length).toBe(dim)
      }

      // 3072 should fail (exceeds original)
      expect(() => handler.truncate(embedding, 3072)).toThrow()
    })
  })

  // ============================================================================
  // TESTS: BINARY QUANTIZATION INTEGRATION
  // ============================================================================

  describe('binary quantization integration', () => {
    it('should integrate with binary quantization (truncate then quantize)', () => {
      const embedding = randomVector(1536, 42)

      // Truncate to 256 dims, then quantize to 1 bit per dimension
      const quantized = truncateAndQuantize(embedding, 256, 1)

      expect(quantized).toBeInstanceOf(Uint8Array)
      // 256 bits = 32 bytes
      expect(quantized.length).toBe(32)
    })

    it('should support different quantization bit depths', () => {
      const embedding = randomVector(1536, 42)

      // 1-bit quantization (binary)
      const binary = truncateAndQuantize(embedding, 256, 1)
      expect(binary.length).toBe(32) // 256 bits / 8 = 32 bytes

      // 2-bit quantization
      const twoBit = truncateAndQuantize(embedding, 256, 2)
      expect(twoBit.length).toBe(64) // 256 * 2 bits / 8 = 64 bytes

      // 4-bit quantization
      const fourBit = truncateAndQuantize(embedding, 256, 4)
      expect(fourBit.length).toBe(128) // 256 * 4 bits / 8 = 128 bytes

      // 8-bit quantization (int8)
      const eightBit = truncateAndQuantize(embedding, 256, 8)
      expect(eightBit.length).toBe(256) // 256 bytes
    })

    it('should achieve maximum compression with truncate + binary quantize', () => {
      // Original: 1536 dims * 4 bytes = 6144 bytes
      // Truncated to 256: 256 * 4 = 1024 bytes (6x compression)
      // Binary quantized: 256 / 8 = 32 bytes (192x total compression!)

      const embedding = randomVector(1536, 42)
      const quantized = truncateAndQuantize(embedding, 256, 1)

      const originalBytes = 1536 * 4
      const compressedBytes = quantized.length
      const compressionRatio = originalBytes / compressedBytes

      expect(compressionRatio).toBe(192) // 6144 / 32 = 192x
    })

    it('should preserve approximate similarity ordering after truncate + quantize', () => {
      const query = unitVector(1536, 1)
      const candidates = [
        unitVector(1536, 10),
        unitVector(1536, 20),
        unitVector(1536, 30),
      ]

      // Make first candidate most similar
      for (let i = 0; i < 768; i++) {
        candidates[0][i] = query[i] * 0.9 + candidates[0][i] * 0.1
      }
      const norm = l2Norm(candidates[0])
      for (let i = 0; i < candidates[0].length; i++) candidates[0][i] /= norm

      // Original ranking
      const originalSims = candidates.map((c) => cosineSim(query, c))
      const originalRanking = originalSims
        .map((s, i) => ({ s, i }))
        .sort((a, b) => b.s - a.s)
        .map((x) => x.i)

      // After truncate + quantize, ranking should be preserved
      // (This tests that the pipeline doesn't destroy similarity structure)
      const queryQuantized = truncateAndQuantize(query, 256, 1)
      const candidatesQuantized = candidates.map((c) =>
        truncateAndQuantize(c, 256, 1)
      )

      // Compute Hamming distances (lower = more similar for binary)
      function hammingDistance(a: Uint8Array, b: Uint8Array): number {
        let dist = 0
        for (let i = 0; i < a.length; i++) {
          let xor = a[i] ^ b[i]
          while (xor) {
            dist += xor & 1
            xor >>= 1
          }
        }
        return dist
      }

      const quantizedDists = candidatesQuantized.map((c) =>
        hammingDistance(queryQuantized, c)
      )
      const quantizedRanking = quantizedDists
        .map((d, i) => ({ d, i }))
        .sort((a, b) => a.d - b.d) // Lower distance = more similar
        .map((x) => x.i)

      // First (most similar) should ideally remain first
      // Allow some tolerance since quantization is lossy
      expect(quantizedRanking[0]).toBe(originalRanking[0])
    })
  })

  // ============================================================================
  // TESTS: HANDLER CLASS
  // ============================================================================

  describe('MatryoshkaHandler class', () => {
    it('should create handler with original dimension', () => {
      const handler = new MatryoshkaHandler({ originalDimension: 1536 })

      expect(handler.originalDimension).toBe(1536)
      expect(handler.supportedDimensions).toBeDefined()
      expect(Array.isArray(handler.supportedDimensions)).toBe(true)
    })

    it('should create handler with custom supported dimensions', () => {
      const customDims = [128, 256, 512]
      const handler = new MatryoshkaHandler({
        originalDimension: 1536,
        supportedDimensions: customDims,
      })

      expect(handler.supportedDimensions).toEqual(customDims)
    })

    it('should validate dimension against original', () => {
      const handler = new MatryoshkaHandler({ originalDimension: 1536 })

      expect(handler.validateDimension(256)).toBe(true)
      expect(handler.validateDimension(1536)).toBe(true)
      expect(handler.validateDimension(2048)).toBe(false) // Exceeds original
    })

    it('should compute similarity between same-dimension vectors', () => {
      const handler = new MatryoshkaHandler({ originalDimension: 1536 })

      const a = unitVector(512, 1)
      const b = unitVector(512, 2)

      const similarity = handler.similarity(a, b)

      expect(typeof similarity).toBe('number')
      expect(similarity).toBeGreaterThanOrEqual(-1)
      expect(similarity).toBeLessThanOrEqual(1)
    })
  })

  // ============================================================================
  // TESTS: EDGE CASES
  // ============================================================================

  describe('edge cases', () => {
    it('should handle single dimension truncation', () => {
      const embedding = randomVector(1536, 42)

      const truncated = truncateEmbedding(embedding, 1)

      expect(truncated.length).toBe(1)
      expect(truncated[0]).toBe(embedding[0])
    })

    it('should handle NaN values gracefully', () => {
      const embedding = new Float32Array([1, NaN, 2, 3, 4, 5, 6, 7])

      // Should truncate without error
      expect(() => truncateEmbedding(embedding, 4)).not.toThrow()

      const truncated = truncateEmbedding(embedding, 4)
      expect(truncated[1]).toBeNaN() // NaN should be preserved
    })

    it('should handle Infinity values', () => {
      const embedding = new Float32Array([1, Infinity, -Infinity, 3, 4, 5, 6, 7])

      const truncated = truncateEmbedding(embedding, 4)

      expect(truncated[1]).toBe(Infinity)
      expect(truncated[2]).toBe(-Infinity)
    })

    it('should handle zero vector', () => {
      const embedding = new Float32Array(1536).fill(0)

      const truncated = truncateEmbedding(embedding, 256)

      expect(truncated.every((v) => v === 0)).toBe(true)

      // Normalizing zero vector should handle gracefully (or throw)
      expect(() =>
        truncateEmbedding(embedding, 256, { normalize: true })
      ).toThrow(/zero.*norm|cannot.*normalize/i)
    })

    it('should handle very small dimensions', () => {
      const handler = new MatryoshkaHandler({ originalDimension: 1536 })

      const embedding = randomVector(1536, 42)

      for (const dim of [1, 2, 4, 8, 16, 32]) {
        const truncated = handler.truncate(embedding, dim)
        expect(truncated.length).toBe(dim)
      }
    })
  })

  // ============================================================================
  // TESTS: PERFORMANCE CHARACTERISTICS
  // ============================================================================

  describe('performance characteristics', () => {
    it('should truncate large batches within reasonable time', () => {
      const embeddings: Float32Array[] = []
      for (let i = 0; i < 10000; i++) {
        embeddings.push(randomVector(1536, i))
      }

      const start = performance.now()
      const truncated = batchTruncate(embeddings, 256, { normalize: true })
      const elapsed = performance.now() - start

      expect(truncated).toHaveLength(10000)

      // Should complete within 1 second for 10K vectors
      // (This is a soft performance test, may need adjustment)
      expect(elapsed).toBeLessThan(1000)
    })

    it('should not allocate new array for in-place truncation hint', () => {
      // This tests that the implementation can be efficient
      // when the caller indicates they want a view, not a copy
      const embedding = randomVector(1536, 42)

      // Get the underlying buffer start position
      const originalBuffer = embedding.buffer

      // Truncate with view option (if supported)
      // Note: Implementation may or may not support this optimization
      const truncated = truncateEmbedding(embedding, 256)

      // Verify truncated is correct regardless of allocation strategy
      expect(truncated.length).toBe(256)
      for (let i = 0; i < 256; i++) {
        expect(truncated[i]).toBe(embedding[i])
      }
    })
  })
})
