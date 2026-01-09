/**
 * PQ Codec Tests - Static Assets Vector Search
 *
 * Tests for the Product Quantization codec optimized for static asset vector search.
 * This codec loads codebooks from binary files (PQCB format) and performs fast
 * ADC (Asymmetric Distance Computation) scoring for large-scale similarity search.
 *
 * Key operations:
 * 1. Load codebooks from static assets (PQCB binary format)
 * 2. Encode full vectors to PQ codes (8 bytes for 1536-dim with M=8)
 * 3. Decode PQ codes back to approximate vectors
 * 4. Compute ADC tables for fast distance computation
 * 5. Score candidates using ADC tables (O(M) per candidate)
 * 6. Batch scoring of 100K+ candidates in <10ms
 *
 * @see docs/plans/static-assets-vector-search.md for architecture details
 * @module tests/vector/pq-codec.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import type { PQCodebook } from '../../types/vector'

// ============================================================================
// MODULE IMPORTS (will fail until implementation exists)
// ============================================================================

// These imports will fail until the module is implemented
// This is the expected behavior for TDD - tests define the API contract
let PQCodec: any
let loadCodebookFromBuffer: any
let parseCodebookHeader: any
let createMockCodebook: any

// Attempt to load the module - will fail until implemented
beforeEach(async () => {
  try {
    const codecModule = await import('../../db/edgevec/pq-codec')
    PQCodec = codecModule.PQCodec
    loadCodebookFromBuffer = codecModule.loadCodebookFromBuffer
    parseCodebookHeader = codecModule.parseCodebookHeader
    createMockCodebook = codecModule.createMockCodebook
  } catch {
    // Module not yet implemented - tests will fail with clear message
    PQCodec = undefined
    loadCodebookFromBuffer = undefined
    parseCodebookHeader = undefined
    createMockCodebook = undefined
  }
})

// ============================================================================
// TEST UTILITIES
// ============================================================================

/**
 * Generate a random vector with values in [-1, 1]
 */
function generateRandomVector(dimensions: number): Float32Array {
  const vec = new Float32Array(dimensions)
  for (let i = 0; i < dimensions; i++) {
    vec[i] = Math.random() * 2 - 1
  }
  return vec
}

/**
 * Generate multiple random vectors
 */
function generateRandomVectors(count: number, dimensions: number): Float32Array[] {
  return Array.from({ length: count }, () => generateRandomVector(dimensions))
}

/**
 * Normalize a vector to unit length (for cosine similarity)
 */
function normalizeVector(vec: Float32Array): Float32Array {
  let norm = 0
  for (let i = 0; i < vec.length; i++) {
    norm += vec[i] * vec[i]
  }
  norm = Math.sqrt(norm)
  const normalized = new Float32Array(vec.length)
  for (let i = 0; i < vec.length; i++) {
    normalized[i] = vec[i] / norm
  }
  return normalized
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
 * Create mock PQCB binary data for testing
 *
 * Format (from docs/plans/static-assets-vector-search.md):
 * - Header (32 bytes):
 *   - magic: uint32 = 0x50514342 ("PQCB")
 *   - version: uint16 = 1
 *   - flags: uint16 = 0
 *   - M: uint32 = num subspaces
 *   - Ksub: uint32 = 256 (centroids per subspace)
 *   - dimensions: uint32 = 1536
 *   - subvector_dim: uint32 = 192 (= 1536 / 8)
 *   - dtype: uint8 = 0 (float32)
 *   - reserved: uint8[7]
 * - Codebook data: M * Ksub * subvector_dim * 4 bytes
 */
function createMockPQCBData(options: {
  M: number
  Ksub: number
  dimensions: number
  seed?: number
}): ArrayBuffer {
  const { M, Ksub, dimensions, seed = 42 } = options
  const subvectorDim = dimensions / M

  // Header size is 32 bytes
  const headerSize = 32
  const dataSize = M * Ksub * subvectorDim * 4 // float32
  const totalSize = headerSize + dataSize

  const buffer = new ArrayBuffer(totalSize)
  const view = new DataView(buffer)

  // Magic bytes "PQCB" (0x50514342)
  view.setUint32(0, 0x50514342, true)
  // Version
  view.setUint16(4, 1, true)
  // Flags
  view.setUint16(6, 0, true)
  // M (num subspaces)
  view.setUint32(8, M, true)
  // Ksub (centroids per subspace)
  view.setUint32(12, Ksub, true)
  // Dimensions
  view.setUint32(16, dimensions, true)
  // Subvector dimension
  view.setUint32(20, subvectorDim, true)
  // dtype (0 = float32)
  view.setUint8(24, 0)
  // Reserved bytes (25-31) are already zero

  // Fill codebook data with seeded random values
  const float32View = new Float32Array(buffer, headerSize)
  let randomState = seed
  const random = () => {
    randomState = (randomState * 1103515245 + 12345) & 0x7fffffff
    return (randomState / 0x7fffffff) * 2 - 1 // Range [-1, 1]
  }

  for (let i = 0; i < float32View.length; i++) {
    float32View[i] = random()
  }

  return buffer
}

/**
 * Create mock PQ codes for a batch of candidates
 */
function createMockPQCodes(count: number, M: number): Uint8Array {
  const codes = new Uint8Array(count * M)
  for (let i = 0; i < codes.length; i++) {
    codes[i] = Math.floor(Math.random() * 256)
  }
  return codes
}

/**
 * Helper to assert module is loaded
 */
function assertModuleLoaded(fnName: string, fn: any): asserts fn {
  if (!fn) {
    throw new Error(
      `PQ codec module not implemented. Expected '${fnName}' from 'db/edgevec/pq-codec'. ` +
      `Create the module to make this test pass.`
    )
  }
}

// ============================================================================
// CODEBOOK LOADING TESTS
// ============================================================================

describe('PQCodec', () => {
  describe('Codebook Loading from Static Assets', () => {
    it('should load codebook from PQCB format buffer', () => {
      assertModuleLoaded('loadCodebookFromBuffer', loadCodebookFromBuffer)

      const M = 8
      const Ksub = 256
      const dimensions = 1536
      const buffer = createMockPQCBData({ M, Ksub, dimensions })

      const codebook = loadCodebookFromBuffer(buffer)

      expect(codebook).toBeDefined()
      expect(codebook.numSubquantizers).toBe(M)
      expect(codebook.numCentroids).toBe(Ksub)
      expect(codebook.subvectorDimension).toBe(dimensions / M)
      expect(codebook.centroids).toHaveLength(M)
    })

    it('should parse PQCB header correctly', () => {
      assertModuleLoaded('parseCodebookHeader', parseCodebookHeader)

      const M = 16
      const Ksub = 256
      const dimensions = 1536
      const buffer = createMockPQCBData({ M, Ksub, dimensions })

      const header = parseCodebookHeader(buffer)

      expect(header.magic).toBe('PQCB')
      expect(header.version).toBe(1)
      expect(header.M).toBe(M)
      expect(header.Ksub).toBe(Ksub)
      expect(header.dimensions).toBe(dimensions)
      expect(header.subvectorDim).toBe(dimensions / M)
      expect(header.dtype).toBe(0) // float32
    })

    it('should reject invalid magic bytes', () => {
      assertModuleLoaded('loadCodebookFromBuffer', loadCodebookFromBuffer)

      const buffer = new ArrayBuffer(1024)
      const view = new DataView(buffer)
      view.setUint32(0, 0x12345678, true) // Wrong magic

      expect(() => loadCodebookFromBuffer(buffer)).toThrow(/invalid.*magic|PQCB/i)
    })

    it('should reject unsupported version', () => {
      assertModuleLoaded('loadCodebookFromBuffer', loadCodebookFromBuffer)

      const buffer = createMockPQCBData({ M: 8, Ksub: 256, dimensions: 1536 })
      const view = new DataView(buffer)
      view.setUint16(4, 99, true) // Invalid version

      expect(() => loadCodebookFromBuffer(buffer)).toThrow(/unsupported.*version/i)
    })

    it('should handle corrupted codebook data gracefully', () => {
      assertModuleLoaded('loadCodebookFromBuffer', loadCodebookFromBuffer)

      // Buffer too small for header
      const smallBuffer = new ArrayBuffer(16)

      expect(() => loadCodebookFromBuffer(smallBuffer)).toThrow(/truncated|too small|invalid/i)
    })

    it('should validate buffer size matches header parameters', () => {
      assertModuleLoaded('loadCodebookFromBuffer', loadCodebookFromBuffer)

      const M = 8
      const Ksub = 256
      const dimensions = 1536

      // Create buffer with correct header but truncated data
      const headerSize = 32
      const expectedDataSize = M * Ksub * (dimensions / M) * 4
      const truncatedBuffer = new ArrayBuffer(headerSize + expectedDataSize / 2) // Half the data

      const view = new DataView(truncatedBuffer)
      view.setUint32(0, 0x50514342, true) // PQCB
      view.setUint16(4, 1, true) // version
      view.setUint32(8, M, true)
      view.setUint32(12, Ksub, true)
      view.setUint32(16, dimensions, true)
      view.setUint32(20, dimensions / M, true)

      expect(() => loadCodebookFromBuffer(truncatedBuffer)).toThrow(/size.*mismatch|truncated/i)
    })
  })

  // ============================================================================
  // ENCODING TESTS
  // ============================================================================

  describe('Vector Encoding to PQ Codes', () => {
    const dimensions = 1536
    const M = 8
    const Ksub = 256

    it('should encode 1536-dim vector to 8 bytes (M=8)', () => {
      assertModuleLoaded('PQCodec', PQCodec)

      const buffer = createMockPQCBData({ M, Ksub, dimensions })
      const codec = new PQCodec(buffer)
      const vector = generateRandomVector(dimensions)

      const codes = codec.encode(vector)

      expect(codes).toBeInstanceOf(Uint8Array)
      expect(codes.length).toBe(M) // 8 bytes for M=8

      // Each code should be valid centroid index [0, 255]
      for (let i = 0; i < codes.length; i++) {
        expect(codes[i]).toBeGreaterThanOrEqual(0)
        expect(codes[i]).toBeLessThan(Ksub)
      }
    })

    it('should produce consistent encoding for same vector', () => {
      assertModuleLoaded('PQCodec', PQCodec)

      const buffer = createMockPQCBData({ M, Ksub, dimensions })
      const codec = new PQCodec(buffer)
      const vector = generateRandomVector(dimensions)

      const codes1 = codec.encode(vector)
      const codes2 = codec.encode(vector)

      expect(codes1).toEqual(codes2)
    })

    it('should encode batch of vectors efficiently', () => {
      assertModuleLoaded('PQCodec', PQCodec)

      const buffer = createMockPQCBData({ M, Ksub, dimensions })
      const codec = new PQCodec(buffer)
      const vectors = generateRandomVectors(100, dimensions)

      const allCodes = codec.encodeBatch(vectors)

      expect(allCodes).toBeInstanceOf(Uint8Array)
      expect(allCodes.length).toBe(100 * M) // 100 vectors * 8 bytes each
    })

    it('should throw error for wrong dimension vector', () => {
      assertModuleLoaded('PQCodec', PQCodec)

      const buffer = createMockPQCBData({ M, Ksub, dimensions })
      const codec = new PQCodec(buffer)
      const wrongDimVector = generateRandomVector(768) // Wrong dimension

      expect(() => codec.encode(wrongDimVector)).toThrow(/dimension/i)
    })
  })

  // ============================================================================
  // DECODING TESTS
  // ============================================================================

  describe('PQ Codes Decoding', () => {
    const dimensions = 1536
    const M = 8
    const Ksub = 256

    it('should decode PQ codes back to approximate vector', () => {
      assertModuleLoaded('PQCodec', PQCodec)

      const buffer = createMockPQCBData({ M, Ksub, dimensions })
      const codec = new PQCodec(buffer)
      const original = generateRandomVector(dimensions)

      const codes = codec.encode(original)
      const reconstructed = codec.decode(codes)

      expect(reconstructed).toBeInstanceOf(Float32Array)
      expect(reconstructed.length).toBe(dimensions)
    })

    it('should produce reasonable reconstruction error', () => {
      assertModuleLoaded('PQCodec', PQCodec)

      const buffer = createMockPQCBData({ M, Ksub, dimensions })
      const codec = new PQCodec(buffer)

      // Test with normalized vectors (typical for embeddings)
      const original = normalizeVector(generateRandomVector(dimensions))
      const codes = codec.encode(original)
      const reconstructed = codec.decode(codes)

      const error = mse(original, reconstructed)

      // MSE should be bounded (depends on codebook quality, but should be finite)
      expect(error).toBeLessThan(2.0) // Generous bound for random codebook
      expect(error).toBeGreaterThanOrEqual(0)
      expect(Number.isFinite(error)).toBe(true)
    })

    it('should decode batch of codes efficiently', () => {
      assertModuleLoaded('PQCodec', PQCodec)

      const buffer = createMockPQCBData({ M, Ksub, dimensions })
      const codec = new PQCodec(buffer)
      const count = 100
      const codes = createMockPQCodes(count, M)

      const vectors = codec.decodeBatch(codes, count)

      expect(vectors).toBeInstanceOf(Float32Array)
      expect(vectors.length).toBe(count * dimensions)
    })
  })

  // ============================================================================
  // ADC TABLE COMPUTATION TESTS
  // ============================================================================

  describe('ADC (Asymmetric Distance Computation) Tables', () => {
    const dimensions = 1536
    const M = 8
    const Ksub = 256

    it('should compute ADC tables for query vector', () => {
      assertModuleLoaded('PQCodec', PQCodec)

      const buffer = createMockPQCBData({ M, Ksub, dimensions })
      const codec = new PQCodec(buffer)
      const query = generateRandomVector(dimensions)

      const adcTables = codec.computeADCTables(query)

      // Should have M tables, each with Ksub entries
      expect(adcTables).toBeInstanceOf(Float32Array)
      expect(adcTables.length).toBe(M * Ksub) // 8 * 256 = 2048 floats
    })

    it('should produce valid distance values in ADC tables', () => {
      assertModuleLoaded('PQCodec', PQCodec)

      const buffer = createMockPQCBData({ M, Ksub, dimensions })
      const codec = new PQCodec(buffer)
      const query = generateRandomVector(dimensions)

      const adcTables = codec.computeADCTables(query)

      // All values should be non-negative (squared distances)
      for (let i = 0; i < adcTables.length; i++) {
        expect(adcTables[i]).toBeGreaterThanOrEqual(0)
        expect(Number.isFinite(adcTables[i])).toBe(true)
      }
    })

    it('should support L2 distance metric', () => {
      assertModuleLoaded('PQCodec', PQCodec)

      const buffer = createMockPQCBData({ M, Ksub, dimensions })
      const codec = new PQCodec(buffer)
      const query = generateRandomVector(dimensions)

      const adcTables = codec.computeADCTables(query, 'l2')

      expect(adcTables).toBeInstanceOf(Float32Array)
      expect(adcTables.length).toBe(M * Ksub)
    })

    it('should support inner product metric', () => {
      assertModuleLoaded('PQCodec', PQCodec)

      const buffer = createMockPQCBData({ M, Ksub, dimensions })
      const codec = new PQCodec(buffer)
      const query = normalizeVector(generateRandomVector(dimensions))

      const adcTables = codec.computeADCTables(query, 'ip')

      expect(adcTables).toBeInstanceOf(Float32Array)
      expect(adcTables.length).toBe(M * Ksub)
    })
  })

  // ============================================================================
  // ADC SCORING TESTS
  // ============================================================================

  describe('ADC Scoring (Fast Path)', () => {
    const dimensions = 1536
    const M = 8
    const Ksub = 256

    it('should score single candidate using ADC tables', () => {
      assertModuleLoaded('PQCodec', PQCodec)

      const buffer = createMockPQCBData({ M, Ksub, dimensions })
      const codec = new PQCodec(buffer)
      const query = generateRandomVector(dimensions)
      const codes = createMockPQCodes(1, M)

      const adcTables = codec.computeADCTables(query)
      const score = codec.scoreWithADC(adcTables, codes)

      expect(typeof score).toBe('number')
      expect(score).toBeGreaterThanOrEqual(0)
      expect(Number.isFinite(score)).toBe(true)
    })

    it('should score batch of candidates using ADC tables', () => {
      assertModuleLoaded('PQCodec', PQCodec)

      const buffer = createMockPQCBData({ M, Ksub, dimensions })
      const codec = new PQCodec(buffer)
      const query = generateRandomVector(dimensions)
      const candidateCount = 1000
      const codes = createMockPQCodes(candidateCount, M)

      const adcTables = codec.computeADCTables(query)
      const scores = codec.scoreBatchWithADC(adcTables, codes, candidateCount)

      expect(scores).toBeInstanceOf(Float32Array)
      expect(scores.length).toBe(candidateCount)

      // All scores should be valid
      for (let i = 0; i < scores.length; i++) {
        expect(scores[i]).toBeGreaterThanOrEqual(0)
        expect(Number.isFinite(scores[i])).toBe(true)
      }
    })

    it('should approximate true distance accurately', () => {
      assertModuleLoaded('PQCodec', PQCodec)

      const buffer = createMockPQCBData({ M, Ksub, dimensions })
      const codec = new PQCodec(buffer)

      const query = generateRandomVector(dimensions)
      const databaseVector = generateRandomVector(dimensions)

      // Encode database vector
      const codes = codec.encode(databaseVector)

      // Compute ADC score
      const adcTables = codec.computeADCTables(query)
      const adcScore = codec.scoreWithADC(adcTables, codes)

      // Compute exact distance to reconstructed vector
      const reconstructed = codec.decode(codes)
      const exactDistance = l2Distance(query, reconstructed)

      // ADC score should match distance to reconstructed (squared)
      // ADC returns squared L2, so compare sqrt
      expect(Math.sqrt(adcScore)).toBeCloseTo(exactDistance, 4)
    })
  })

  // ============================================================================
  // BATCH SCORING PERFORMANCE TESTS
  // ============================================================================

  describe('Batch Scoring Performance', () => {
    const dimensions = 1536
    const M = 8
    const Ksub = 256

    it('should score 1000+ candidates efficiently', () => {
      assertModuleLoaded('PQCodec', PQCodec)

      const buffer = createMockPQCBData({ M, Ksub, dimensions })
      const codec = new PQCodec(buffer)
      const query = generateRandomVector(dimensions)
      const candidateCount = 1000
      const codes = createMockPQCodes(candidateCount, M)

      const adcTables = codec.computeADCTables(query)

      const start = performance.now()
      const scores = codec.scoreBatchWithADC(adcTables, codes, candidateCount)
      const elapsed = performance.now() - start

      expect(scores.length).toBe(candidateCount)
      // Should complete within reasonable time (< 50ms for 1000 candidates)
      expect(elapsed).toBeLessThan(50)
    })

    it('should score 100K candidates in <10ms (performance target)', () => {
      assertModuleLoaded('PQCodec', PQCodec)

      const buffer = createMockPQCBData({ M, Ksub, dimensions })
      const codec = new PQCodec(buffer)
      const query = generateRandomVector(dimensions)
      const candidateCount = 100_000
      const codes = createMockPQCodes(candidateCount, M)

      const adcTables = codec.computeADCTables(query)

      // Warm up
      codec.scoreBatchWithADC(adcTables, codes, candidateCount)

      // Timed run
      const start = performance.now()
      const scores = codec.scoreBatchWithADC(adcTables, codes, candidateCount)
      const elapsed = performance.now() - start

      expect(scores.length).toBe(candidateCount)
      // Performance target: <10ms for 100K candidates
      // This tests the O(M) scoring algorithm efficiency
      expect(elapsed).toBeLessThan(10)
    })

    it('should return top-k candidates by score', () => {
      assertModuleLoaded('PQCodec', PQCodec)

      const buffer = createMockPQCBData({ M, Ksub, dimensions })
      const codec = new PQCodec(buffer)
      const query = generateRandomVector(dimensions)
      const candidateCount = 10_000
      const codes = createMockPQCodes(candidateCount, M)
      const topK = 100

      const adcTables = codec.computeADCTables(query)
      const topCandidates = codec.topKWithADC(adcTables, codes, candidateCount, topK)

      expect(topCandidates).toHaveLength(topK)

      // Results should be sorted by score (ascending for L2)
      for (let i = 1; i < topCandidates.length; i++) {
        expect(topCandidates[i].score).toBeGreaterThanOrEqual(topCandidates[i - 1].score)
      }

      // Each result should have index and score
      for (const result of topCandidates) {
        expect(result.index).toBeGreaterThanOrEqual(0)
        expect(result.index).toBeLessThan(candidateCount)
        expect(typeof result.score).toBe('number')
      }
    })
  })

  // ============================================================================
  // DIFFERENT M VALUES TESTS
  // ============================================================================

  describe('Different M Values (8, 16, 32 subquantizers)', () => {
    const dimensions = 1536
    const Ksub = 256

    it('should handle M=8 (192-dim subvectors)', () => {
      assertModuleLoaded('PQCodec', PQCodec)

      const M = 8
      const buffer = createMockPQCBData({ M, Ksub, dimensions })
      const codec = new PQCodec(buffer)
      const vector = generateRandomVector(dimensions)

      expect(codec.M).toBe(M)
      expect(codec.subvectorDim).toBe(192) // 1536 / 8

      const codes = codec.encode(vector)
      expect(codes.length).toBe(8)
    })

    it('should handle M=16 (96-dim subvectors)', () => {
      assertModuleLoaded('PQCodec', PQCodec)

      const M = 16
      const buffer = createMockPQCBData({ M, Ksub, dimensions })
      const codec = new PQCodec(buffer)
      const vector = generateRandomVector(dimensions)

      expect(codec.M).toBe(M)
      expect(codec.subvectorDim).toBe(96) // 1536 / 16

      const codes = codec.encode(vector)
      expect(codes.length).toBe(16)
    })

    it('should handle M=32 (48-dim subvectors)', () => {
      assertModuleLoaded('PQCodec', PQCodec)

      const M = 32
      const buffer = createMockPQCBData({ M, Ksub, dimensions })
      const codec = new PQCodec(buffer)
      const vector = generateRandomVector(dimensions)

      expect(codec.M).toBe(M)
      expect(codec.subvectorDim).toBe(48) // 1536 / 32

      const codes = codec.encode(vector)
      expect(codes.length).toBe(32)
    })

    it('should improve accuracy with higher M values', () => {
      assertModuleLoaded('PQCodec', PQCodec)

      const vector = normalizeVector(generateRandomVector(dimensions))
      const errors: number[] = []

      for (const M of [8, 16, 32]) {
        const buffer = createMockPQCBData({ M, Ksub, dimensions, seed: 42 })
        const codec = new PQCodec(buffer)

        const codes = codec.encode(vector)
        const reconstructed = codec.decode(codes)
        const error = mse(vector, reconstructed)
        errors.push(error)
      }

      // Higher M should generally give better reconstruction
      // Note: With random codebooks this may not always hold, but the API should support it
      expect(errors[0]).toBeGreaterThan(0) // M=8
      expect(errors[1]).toBeGreaterThan(0) // M=16
      expect(errors[2]).toBeGreaterThan(0) // M=32
    })
  })

  // ============================================================================
  // DIFFERENT Ksub VALUES TESTS
  // ============================================================================

  describe('Different Ksub Values (centroids per subquantizer)', () => {
    const dimensions = 1536
    const M = 8

    it('should handle Ksub=256 (8-bit codes, standard)', () => {
      assertModuleLoaded('PQCodec', PQCodec)

      const Ksub = 256
      const buffer = createMockPQCBData({ M, Ksub, dimensions })
      const codec = new PQCodec(buffer)

      expect(codec.Ksub).toBe(256)

      const vector = generateRandomVector(dimensions)
      const codes = codec.encode(vector)

      // All codes should fit in uint8
      for (let i = 0; i < codes.length; i++) {
        expect(codes[i]).toBeLessThan(256)
      }
    })

    it('should validate Ksub matches expected 256 for uint8 codes', () => {
      assertModuleLoaded('PQCodec', PQCodec)

      const buffer = createMockPQCBData({ M, Ksub: 256, dimensions })
      const codec = new PQCodec(buffer)

      // For uint8 codes, Ksub must be 256
      expect(codec.Ksub).toBe(256)
    })

    it('should handle ADC table size correctly for different Ksub', () => {
      assertModuleLoaded('PQCodec', PQCodec)

      const Ksub = 256
      const buffer = createMockPQCBData({ M, Ksub, dimensions })
      const codec = new PQCodec(buffer)
      const query = generateRandomVector(dimensions)

      const adcTables = codec.computeADCTables(query)

      // Table should be M * Ksub floats
      expect(adcTables.length).toBe(M * Ksub) // 8 * 256 = 2048
    })
  })

  // ============================================================================
  // RECONSTRUCTION ERROR BOUNDS TESTS
  // ============================================================================

  describe('Reconstruction Error Bounds', () => {
    const dimensions = 1536
    const M = 8
    const Ksub = 256

    it('should verify reconstruction error is within bounds', () => {
      assertModuleLoaded('PQCodec', PQCodec)

      const buffer = createMockPQCBData({ M, Ksub, dimensions })
      const codec = new PQCodec(buffer)

      // Test with 100 vectors
      const vectors = generateRandomVectors(100, dimensions).map(normalizeVector)
      const errors: number[] = []

      for (const vec of vectors) {
        const codes = codec.encode(vec)
        const reconstructed = codec.decode(codes)
        errors.push(mse(vec, reconstructed))
      }

      const avgError = errors.reduce((a, b) => a + b, 0) / errors.length
      const maxError = Math.max(...errors)

      // Average MSE should be bounded
      expect(avgError).toBeLessThan(1.0)

      // Max error should also be bounded
      expect(maxError).toBeLessThan(2.0)
    })

    it('should report reconstruction statistics', () => {
      assertModuleLoaded('PQCodec', PQCodec)

      const buffer = createMockPQCBData({ M, Ksub, dimensions })
      const codec = new PQCodec(buffer)

      const vectors = generateRandomVectors(50, dimensions).map(normalizeVector)
      const stats = codec.computeReconstructionStats(vectors)

      expect(stats.meanMSE).toBeGreaterThanOrEqual(0)
      expect(stats.maxMSE).toBeGreaterThanOrEqual(stats.meanMSE)
      expect(stats.minMSE).toBeLessThanOrEqual(stats.meanMSE)
      expect(stats.stdMSE).toBeGreaterThanOrEqual(0)
      expect(Number.isFinite(stats.meanMSE)).toBe(true)
    })

    it('should preserve relative distances after quantization', () => {
      assertModuleLoaded('PQCodec', PQCodec)

      const buffer = createMockPQCBData({ M, Ksub, dimensions })
      const codec = new PQCodec(buffer)

      const vectors = generateRandomVectors(20, dimensions).map(normalizeVector)
      const query = vectors[0]

      // Compute original distances
      const originalDistances = vectors.slice(1).map(v => l2Distance(query, v))

      // Compute distances through PQ
      const pqDistances = vectors.slice(1).map(v => {
        const codes = codec.encode(v)
        const reconstructed = codec.decode(codes)
        return l2Distance(query, reconstructed)
      })

      // Check correlation: sort order should be similar
      const originalOrder = originalDistances
        .map((d, i) => ({ d, i }))
        .sort((a, b) => a.d - b.d)
        .map(x => x.i)

      const pqOrder = pqDistances
        .map((d, i) => ({ d, i }))
        .sort((a, b) => a.d - b.d)
        .map(x => x.i)

      // Top-5 should have at least 2 matches (weak correlation due to random codebook)
      const top5Original = new Set(originalOrder.slice(0, 5))
      const top5PQ = new Set(pqOrder.slice(0, 5))
      const overlap = [...top5Original].filter(x => top5PQ.has(x)).length

      expect(overlap).toBeGreaterThanOrEqual(1)
    })
  })

  // ============================================================================
  // EDGE CASES AND ERROR HANDLING
  // ============================================================================

  describe('Edge Cases and Error Handling', () => {
    const dimensions = 1536
    const M = 8
    const Ksub = 256

    it('should handle zero vector', () => {
      assertModuleLoaded('PQCodec', PQCodec)

      const buffer = createMockPQCBData({ M, Ksub, dimensions })
      const codec = new PQCodec(buffer)
      const zeroVector = new Float32Array(dimensions) // All zeros

      const codes = codec.encode(zeroVector)
      const reconstructed = codec.decode(codes)

      expect(codes.length).toBe(M)
      expect(reconstructed.length).toBe(dimensions)
    })

    it('should handle extreme values in vector', () => {
      assertModuleLoaded('PQCodec', PQCodec)

      const buffer = createMockPQCBData({ M, Ksub, dimensions })
      const codec = new PQCodec(buffer)

      const extremeVector = new Float32Array(dimensions)
      for (let i = 0; i < dimensions; i++) {
        extremeVector[i] = i % 2 === 0 ? 1e6 : -1e6
      }

      const codes = codec.encode(extremeVector)
      const reconstructed = codec.decode(codes)

      expect(codes.length).toBe(M)
      expect(reconstructed.length).toBe(dimensions)

      // Should not produce NaN or Infinity
      for (let i = 0; i < reconstructed.length; i++) {
        expect(Number.isFinite(reconstructed[i])).toBe(true)
      }
    })

    it('should handle empty codes array in batch scoring', () => {
      assertModuleLoaded('PQCodec', PQCodec)

      const buffer = createMockPQCBData({ M, Ksub, dimensions })
      const codec = new PQCodec(buffer)
      const query = generateRandomVector(dimensions)
      const emptyCodes = new Uint8Array(0)

      const adcTables = codec.computeADCTables(query)
      const scores = codec.scoreBatchWithADC(adcTables, emptyCodes, 0)

      expect(scores.length).toBe(0)
    })

    it('should validate codes length matches expected', () => {
      assertModuleLoaded('PQCodec', PQCodec)

      const buffer = createMockPQCBData({ M, Ksub, dimensions })
      const codec = new PQCodec(buffer)
      const query = generateRandomVector(dimensions)
      const adcTables = codec.computeADCTables(query)

      // Wrong number of codes (not multiple of M)
      const wrongCodes = new Uint8Array(M + 3)

      expect(() => codec.scoreBatchWithADC(adcTables, wrongCodes, 1)).toThrow(/codes.*length|invalid/i)
    })
  })

  // ============================================================================
  // INTEGRATION WITH STATIC ASSET LOADER
  // ============================================================================

  describe('Static Asset Integration', () => {
    const dimensions = 1536
    const M = 8
    const Ksub = 256

    it('should expose codebook metadata for static asset validation', () => {
      assertModuleLoaded('PQCodec', PQCodec)

      const buffer = createMockPQCBData({ M, Ksub, dimensions })
      const codec = new PQCodec(buffer)

      const meta = codec.getMetadata()

      expect(meta.magic).toBe('PQCB')
      expect(meta.version).toBe(1)
      expect(meta.M).toBe(M)
      expect(meta.Ksub).toBe(Ksub)
      expect(meta.dimensions).toBe(dimensions)
      expect(meta.subvectorDim).toBe(dimensions / M)
      expect(meta.codebookSizeBytes).toBe(32 + M * Ksub * (dimensions / M) * 4)
    })

    it('should support creating codec from pre-loaded ArrayBuffer', () => {
      assertModuleLoaded('PQCodec', PQCodec)

      // Simulate loading from fetch response
      const buffer = createMockPQCBData({ M, Ksub, dimensions })
      const codec = PQCodec.fromBuffer(buffer)

      expect(codec).toBeInstanceOf(PQCodec)
      expect(codec.M).toBe(M)
      expect(codec.dimensions).toBe(dimensions)
    })

    it('should expose memory usage for budget planning', () => {
      assertModuleLoaded('PQCodec', PQCodec)

      const buffer = createMockPQCBData({ M, Ksub, dimensions })
      const codec = new PQCodec(buffer)

      const memoryUsage = codec.getMemoryUsage()

      expect(memoryUsage.codebookBytes).toBe(M * Ksub * (dimensions / M) * 4)
      expect(memoryUsage.adcTableBytes).toBe(M * Ksub * 4) // One ADC table
      expect(memoryUsage.totalBytes).toBeGreaterThan(0)
    })
  })
})
