/**
 * Binary Quantization Tests
 *
 * TDD tests for binary vector quantization used in vector search.
 * Binary quantization converts high-dimensional float vectors into compact
 * binary codes for fast similarity search. Each dimension is reduced to a
 * single bit (1 if >= threshold, 0 otherwise).
 *
 * Benefits:
 * - 32x storage compression (float32 -> 1 bit per dimension)
 * - Fast Hamming distance computation using popcount
 * - Preserves relative similarity rankings
 *
 * @module tests/vector/binary-quantization.test
 */

import { describe, it, expect, beforeEach } from 'vitest'

// ============================================================================
// MODULE IMPORTS (to be implemented)
// ============================================================================

// These imports will fail until the module is implemented
// The tests below verify the expected API and behavior

let toBinary: (vector: Float32Array, options?: { threshold?: number | 'mean' | 'median' }) => Uint8Array
let fromBinary: (binary: Uint8Array, options?: { scale?: number; oneValue?: number; zeroValue?: number }) => Float32Array
let hammingDistance: (a: Uint8Array, b: Uint8Array) => number
let packBits: (bits: Uint8Array) => Uint8Array
let unpackBits: (packed: Uint8Array, dimensions: number) => Uint8Array
let BinaryQuantizer: new (options: { dimensions: number; threshold?: number }) => {
  dimensions: number
  threshold: number
  quantize: (vector: Float32Array) => Uint8Array
  pack: (binary: Uint8Array) => Uint8Array
  unpack: (packed: Uint8Array) => Uint8Array
  distance: (v1: Float32Array, v2: Float32Array) => number
  packedDistance: (p1: Uint8Array, p2: Uint8Array) => number
  getMemoryStats: () => { bitsPerVector: number; bytesPerVector: number; compressionRatio: number }
}
let computeStorageSavings: (dimensions: number) => {
  originalBytes: number
  compressedBytes: number
  compressionRatio: number
  savingsPercent: number
}

// Try to import the module - will fail until implemented
try {
  const mod = await import('../../db/core/vector/quantization/binary')
  toBinary = mod.toBinary
  fromBinary = mod.fromBinary
  hammingDistance = mod.hammingDistance
  packBits = mod.packBits
  unpackBits = mod.unpackBits
  BinaryQuantizer = mod.BinaryQuantizer
  computeStorageSavings = mod.computeStorageSavings
} catch {
  // Module not yet implemented - tests will fail with clear messages
  toBinary = () => { throw new Error('Module not implemented: toBinary') }
  fromBinary = () => { throw new Error('Module not implemented: fromBinary') }
  hammingDistance = () => { throw new Error('Module not implemented: hammingDistance') }
  packBits = () => { throw new Error('Module not implemented: packBits') }
  unpackBits = () => { throw new Error('Module not implemented: unpackBits') }
  BinaryQuantizer = class {
    constructor() { throw new Error('Module not implemented: BinaryQuantizer') }
  } as any
  computeStorageSavings = () => { throw new Error('Module not implemented: computeStorageSavings') }
}

// ============================================================================
// TEST UTILITIES
// ============================================================================

/**
 * Create a random float vector with values between -1 and 1
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

// ============================================================================
// TESTS: BASIC BINARY CONVERSION
// ============================================================================

describe('Binary Quantization', () => {
  describe('toBinary - float vector to binary representation', () => {
    it('should convert float vector to binary representation', () => {
      // Simple test vector with clear positive/negative values
      const vector = new Float32Array([0.5, -0.3, 0.8, -0.1, 0.0, 0.2, -0.9, 0.1])

      const binary = toBinary(vector)

      // With default threshold of 0.0:
      // 0.5 >= 0 -> 1
      // -0.3 < 0 -> 0
      // 0.8 >= 0 -> 1
      // -0.1 < 0 -> 0
      // 0.0 >= 0 -> 1 (edge case: equal to threshold)
      // 0.2 >= 0 -> 1
      // -0.9 < 0 -> 0
      // 0.1 >= 0 -> 1
      // Expected: 10101101 = 0xAD = 173 (when packed LSB first)
      // Or: 10101101 reading left-to-right as bits 0-7

      expect(binary).toBeDefined()
      expect(binary.length).toBe(8) // One bit per dimension
      expect(binary[0]).toBe(1) // 0.5 >= 0
      expect(binary[1]).toBe(0) // -0.3 < 0
      expect(binary[2]).toBe(1) // 0.8 >= 0
      expect(binary[3]).toBe(0) // -0.1 < 0
      expect(binary[4]).toBe(1) // 0.0 >= 0
      expect(binary[5]).toBe(1) // 0.2 >= 0
      expect(binary[6]).toBe(0) // -0.9 < 0
      expect(binary[7]).toBe(1) // 0.1 >= 0
    })

    it('should handle all positive values', () => {
      const vector = new Float32Array([0.1, 0.2, 0.3, 0.4])

      const binary = toBinary(vector)

      expect(binary).toEqual(new Uint8Array([1, 1, 1, 1]))
    })

    it('should handle all negative values', () => {
      const vector = new Float32Array([-0.1, -0.2, -0.3, -0.4])

      const binary = toBinary(vector)

      expect(binary).toEqual(new Uint8Array([0, 0, 0, 0]))
    })

    it('should handle zeros as threshold boundary', () => {
      const vector = new Float32Array([0.0, 0.0, 0.0, 0.0])

      const binary = toBinary(vector)

      // 0.0 >= 0.0 threshold should be 1
      expect(binary).toEqual(new Uint8Array([1, 1, 1, 1]))
    })
  })

  describe('configurable threshold', () => {
    it('should support configurable threshold (default 0.0)', () => {
      const vector = new Float32Array([0.5, 0.3, 0.1, -0.1, -0.3, -0.5])

      // Default threshold = 0.0
      const binaryDefault = toBinary(vector)
      expect(binaryDefault).toEqual(new Uint8Array([1, 1, 1, 0, 0, 0]))

      // Custom threshold = 0.2
      const binaryCustom = toBinary(vector, { threshold: 0.2 })
      // 0.5 >= 0.2 -> 1
      // 0.3 >= 0.2 -> 1
      // 0.1 < 0.2 -> 0
      // -0.1 < 0.2 -> 0
      // -0.3 < 0.2 -> 0
      // -0.5 < 0.2 -> 0
      expect(binaryCustom).toEqual(new Uint8Array([1, 1, 0, 0, 0, 0]))
    })

    it('should support negative threshold', () => {
      const vector = new Float32Array([0.5, 0.0, -0.1, -0.3])

      const binary = toBinary(vector, { threshold: -0.2 })

      // 0.5 >= -0.2 -> 1
      // 0.0 >= -0.2 -> 1
      // -0.1 >= -0.2 -> 1
      // -0.3 < -0.2 -> 0
      expect(binary).toEqual(new Uint8Array([1, 1, 1, 0]))
    })

    it('should support threshold based on mean', () => {
      const vector = new Float32Array([1.0, 2.0, 3.0, 4.0])
      // Mean = 2.5

      const binary = toBinary(vector, { threshold: 'mean' })

      // 1.0 < 2.5 -> 0
      // 2.0 < 2.5 -> 0
      // 3.0 >= 2.5 -> 1
      // 4.0 >= 2.5 -> 1
      expect(binary).toEqual(new Uint8Array([0, 0, 1, 1]))
    })

    it('should support threshold based on median', () => {
      const vector = new Float32Array([1.0, 2.0, 3.0, 4.0, 5.0])
      // Median = 3.0

      const binary = toBinary(vector, { threshold: 'median' })

      // 1.0 < 3.0 -> 0
      // 2.0 < 3.0 -> 0
      // 3.0 >= 3.0 -> 1
      // 4.0 >= 3.0 -> 1
      // 5.0 >= 3.0 -> 1
      expect(binary).toEqual(new Uint8Array([0, 0, 1, 1, 1]))
    })
  })

  describe('hammingDistance - distance between binary vectors', () => {
    it('should compute Hamming distance between binary vectors', () => {
      const a = new Uint8Array([1, 0, 1, 0, 1, 1, 0, 0])
      const b = new Uint8Array([1, 1, 1, 0, 0, 1, 0, 1])
      //                        =  !=  =  =  != =  =  !=
      // Differences at positions: 1, 4, 7 -> distance = 3

      const distance = hammingDistance(a, b)

      expect(distance).toBe(3)
    })

    it('should return 0 for identical vectors', () => {
      const a = new Uint8Array([1, 0, 1, 0, 1, 1, 0, 0])
      const b = new Uint8Array([1, 0, 1, 0, 1, 1, 0, 0])

      const distance = hammingDistance(a, b)

      expect(distance).toBe(0)
    })

    it('should return full length for completely different vectors', () => {
      const a = new Uint8Array([1, 1, 1, 1, 1, 1, 1, 1])
      const b = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0])

      const distance = hammingDistance(a, b)

      expect(distance).toBe(8)
    })

    it('should handle longer vectors', () => {
      const a = new Uint8Array(128).fill(1)
      const b = new Uint8Array(128).fill(0)

      const distance = hammingDistance(a, b)

      expect(distance).toBe(128)
    })

    it('should throw for mismatched lengths', () => {
      const a = new Uint8Array([1, 0, 1])
      const b = new Uint8Array([1, 0])

      expect(() => hammingDistance(a, b)).toThrow(/length/i)
    })
  })

  describe('packBits - efficient bit packing', () => {
    it('should pack bits efficiently into Uint8Array', () => {
      // 8 bits should pack into 1 byte
      const bits = new Uint8Array([1, 0, 1, 0, 1, 1, 0, 1])

      const packed = packBits(bits)

      expect(packed).toBeInstanceOf(Uint8Array)
      expect(packed.length).toBe(1) // 8 bits = 1 byte

      // Verify the byte value
      // If packed LSB first: bit0=1, bit1=0, bit2=1, bit3=0, bit4=1, bit5=1, bit6=0, bit7=1
      // = 1 + 0 + 4 + 0 + 16 + 32 + 0 + 128 = 181 (0xB5)
      // Or if packed MSB first: 10101101 = 173 (0xAD)
      expect(packed[0]).toBe(0xB5) // LSB first packing
    })

    it('should handle dimensions not divisible by 8', () => {
      // 12 bits should pack into 2 bytes (with padding)
      const bits = new Uint8Array([1, 0, 1, 0, 1, 1, 0, 1, 1, 1, 0, 0])

      const packed = packBits(bits)

      expect(packed.length).toBe(2) // ceil(12/8) = 2 bytes
    })

    it('should handle 128 dimensions', () => {
      const bits = new Uint8Array(128).map((_, i) => i % 2) // alternating 0,1

      const packed = packBits(bits)

      expect(packed.length).toBe(16) // 128 bits = 16 bytes
    })

    it('should handle 768 dimensions', () => {
      const bits = new Uint8Array(768).fill(1)

      const packed = packBits(bits)

      expect(packed.length).toBe(96) // 768 bits = 96 bytes
      // All 1s should give 0xFF for each byte
      expect(packed.every((b) => b === 0xff)).toBe(true)
    })

    it('should handle 1536 dimensions', () => {
      const bits = new Uint8Array(1536).fill(0)

      const packed = packBits(bits)

      expect(packed.length).toBe(192) // 1536 bits = 192 bytes
      // All 0s should give 0x00 for each byte
      expect(packed.every((b) => b === 0x00)).toBe(true)
    })
  })

  describe('unpackBits - reverse of packBits', () => {
    it('should unpack binary back to approximate float vector', () => {
      const original = new Float32Array([0.5, -0.3, 0.8, -0.1])
      const binary = toBinary(original)
      const packed = packBits(binary)

      const unpacked = unpackBits(packed, 4)

      expect(unpacked.length).toBe(4)
      // Unpacked should match binary representation
      expect(unpacked).toEqual(binary)
    })

    it('should roundtrip pack/unpack correctly', () => {
      const bits = new Uint8Array([1, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1])

      const packed = packBits(bits)
      const unpacked = unpackBits(packed, 12)

      expect(unpacked).toEqual(bits)
    })

    it('should handle partial last byte', () => {
      const bits = new Uint8Array([1, 1, 1]) // Only 3 bits

      const packed = packBits(bits)
      const unpacked = unpackBits(packed, 3)

      expect(unpacked).toEqual(bits)
    })
  })

  describe('fromBinary - reconstruct approximate float vector', () => {
    it('should reconstruct approximate float vector from binary', () => {
      const binary = new Uint8Array([1, 0, 1, 0])

      const reconstructed = fromBinary(binary)

      expect(reconstructed).toBeInstanceOf(Float32Array)
      expect(reconstructed.length).toBe(4)

      // Default reconstruction: 1 -> +1.0, 0 -> -1.0
      expect(reconstructed[0]).toBe(1.0)
      expect(reconstructed[1]).toBe(-1.0)
      expect(reconstructed[2]).toBe(1.0)
      expect(reconstructed[3]).toBe(-1.0)
    })

    it('should support custom scale for reconstruction', () => {
      const binary = new Uint8Array([1, 0])

      const reconstructed = fromBinary(binary, { scale: 0.5 })

      expect(reconstructed[0]).toBe(0.5)
      expect(reconstructed[1]).toBe(-0.5)
    })

    it('should support asymmetric reconstruction values', () => {
      const binary = new Uint8Array([1, 0])

      const reconstructed = fromBinary(binary, { oneValue: 0.8, zeroValue: -0.2 })

      expect(reconstructed[0]).toBe(0.8)
      expect(reconstructed[1]).toBe(-0.2)
    })
  })

  describe('cosine similarity preservation', () => {
    it('should preserve cosine similarity ranking after quantization', () => {
      // Create a query vector
      const query = unitVector(128, 1)

      // Create candidate vectors with known similarities
      const similar = unitVector(128, 2) // Should be close to query
      const lessSimilar = unitVector(128, 100) // Should be less similar
      const dissimilar = unitVector(128, 500) // Should be most different

      // Perturb similar to be actually similar to query
      for (let i = 0; i < 64; i++) {
        similar[i] = query[i] * 0.9 + similar[i] * 0.1
      }
      // Normalize
      let norm = 0
      for (let i = 0; i < similar.length; i++) norm += similar[i] * similar[i]
      norm = Math.sqrt(norm)
      for (let i = 0; i < similar.length; i++) similar[i] /= norm

      // Compute original cosine similarities
      const originalSim1 = cosineSimilarity(query, similar)
      const originalSim2 = cosineSimilarity(query, lessSimilar)
      const originalSim3 = cosineSimilarity(query, dissimilar)

      // Quantize all vectors
      const quantizer = new BinaryQuantizer({ dimensions: 128 })
      const queryBinary = quantizer.quantize(query)
      const similarBinary = quantizer.quantize(similar)
      const lessSimilarBinary = quantizer.quantize(lessSimilar)
      const dissimilarBinary = quantizer.quantize(dissimilar)

      // Compute binary distances (lower = more similar)
      const dist1 = hammingDistance(queryBinary, similarBinary)
      const dist2 = hammingDistance(queryBinary, lessSimilarBinary)
      const dist3 = hammingDistance(queryBinary, dissimilarBinary)

      // Ranking should be preserved:
      // If originalSim1 > originalSim2 > originalSim3
      // Then dist1 < dist2 < dist3
      if (originalSim1 > originalSim2) {
        expect(dist1).toBeLessThanOrEqual(dist2)
      }
      if (originalSim2 > originalSim3) {
        expect(dist2).toBeLessThanOrEqual(dist3)
      }
    })

    it('should achieve reasonable recall on synthetic data', () => {
      const dimensions = 128
      const numVectors = 100
      const k = 10

      // Generate random vectors
      const vectors: Float32Array[] = []
      for (let i = 0; i < numVectors; i++) {
        vectors.push(unitVector(dimensions, i))
      }

      // Query vector
      const query = unitVector(dimensions, 999)

      // Compute exact similarities
      const exactSimilarities = vectors.map((v, i) => ({
        index: i,
        similarity: cosineSimilarity(query, v),
      }))
      exactSimilarities.sort((a, b) => b.similarity - a.similarity)
      const exactTopK = new Set(exactSimilarities.slice(0, k).map((r) => r.index))

      // Quantize and compute binary distances
      const quantizer = new BinaryQuantizer({ dimensions })
      const queryBinary = quantizer.quantize(query)
      const binaryDistances = vectors.map((v, i) => ({
        index: i,
        distance: hammingDistance(queryBinary, quantizer.quantize(v)),
      }))
      binaryDistances.sort((a, b) => a.distance - b.distance)
      const binaryTopK = new Set(binaryDistances.slice(0, k).map((r) => r.index))

      // Compute recall
      let overlap = 0
      for (const idx of binaryTopK) {
        if (exactTopK.has(idx)) overlap++
      }
      const recall = overlap / k

      // Binary quantization should achieve at least 50% recall
      // (typically much higher for reasonable distributions)
      expect(recall).toBeGreaterThanOrEqual(0.5)
    })
  })

  describe('dimension handling', () => {
    it('should handle different vector dimensions (128, 256, 384, 768, 1536)', () => {
      const testDimensions = [128, 256, 384, 768, 1536]

      for (const dims of testDimensions) {
        const vector = randomVector(dims)
        const quantizer = new BinaryQuantizer({ dimensions: dims })

        const binary = quantizer.quantize(vector)
        const packed = quantizer.pack(binary)

        expect(binary.length).toBe(dims)
        expect(packed.length).toBe(Math.ceil(dims / 8))

        // Verify unpacking works
        const unpacked = quantizer.unpack(packed)
        expect(unpacked).toEqual(binary)
      }
    })

    it('should handle OpenAI embedding dimensions (1536)', () => {
      const dims = 1536
      const vector = randomVector(dims)
      const quantizer = new BinaryQuantizer({ dimensions: dims })

      const binary = quantizer.quantize(vector)
      const packed = quantizer.pack(binary)

      expect(binary.length).toBe(1536)
      expect(packed.length).toBe(192) // 1536 / 8 = 192 bytes
    })

    it('should handle Cohere embedding dimensions (1024)', () => {
      const dims = 1024
      const vector = randomVector(dims)
      const quantizer = new BinaryQuantizer({ dimensions: dims })

      const binary = quantizer.quantize(vector)
      const packed = quantizer.pack(binary)

      expect(binary.length).toBe(1024)
      expect(packed.length).toBe(128) // 1024 / 8 = 128 bytes
    })

    it('should handle odd dimensions (e.g., 127, 385)', () => {
      for (const dims of [127, 385, 1537]) {
        const vector = randomVector(dims)
        const quantizer = new BinaryQuantizer({ dimensions: dims })

        const binary = quantizer.quantize(vector)
        const packed = quantizer.pack(binary)

        expect(binary.length).toBe(dims)
        expect(packed.length).toBe(Math.ceil(dims / 8))

        // Roundtrip
        const unpacked = quantizer.unpack(packed)
        expect(unpacked).toEqual(binary)
      }
    })
  })

  describe('storage savings', () => {
    it('should provide storage savings calculation (32x compression)', () => {
      const dimensions = 1536

      const savings = computeStorageSavings(dimensions)

      // Float32 = 4 bytes per dimension
      // Binary = 1 bit per dimension = 1/8 byte per dimension
      // Compression ratio = 4 / (1/8) = 32x
      expect(savings.originalBytes).toBe(dimensions * 4) // 6144 bytes
      expect(savings.compressedBytes).toBe(Math.ceil(dimensions / 8)) // 192 bytes
      expect(savings.compressionRatio).toBeCloseTo(32, 1)
      expect(savings.savingsPercent).toBeCloseTo(96.875, 1) // (1 - 1/32) * 100
    })

    it('should calculate savings for different dimensions', () => {
      const testCases = [
        { dims: 128, expectedBytes: 16 },
        { dims: 256, expectedBytes: 32 },
        { dims: 384, expectedBytes: 48 },
        { dims: 768, expectedBytes: 96 },
        { dims: 1536, expectedBytes: 192 },
      ]

      for (const { dims, expectedBytes } of testCases) {
        const savings = computeStorageSavings(dims)

        expect(savings.originalBytes).toBe(dims * 4)
        expect(savings.compressedBytes).toBe(expectedBytes)
        expect(savings.compressionRatio).toBeCloseTo(32, 1)
      }
    })

    it('should handle non-divisible-by-8 dimensions with ceiling', () => {
      const savings = computeStorageSavings(130) // 130 / 8 = 16.25 -> 17 bytes

      expect(savings.compressedBytes).toBe(17)
      expect(savings.originalBytes).toBe(520)
      // Actual ratio will be slightly less than 32 due to padding
      expect(savings.compressionRatio).toBeGreaterThan(30)
    })
  })

  describe('BinaryQuantizer class', () => {
    let quantizer: InstanceType<typeof BinaryQuantizer>

    beforeEach(() => {
      quantizer = new BinaryQuantizer({ dimensions: 128 })
    })

    it('should create quantizer with specified dimensions', () => {
      expect(quantizer.dimensions).toBe(128)
      expect(quantizer.threshold).toBe(0.0)
    })

    it('should create quantizer with custom threshold', () => {
      const q = new BinaryQuantizer({ dimensions: 128, threshold: 0.5 })
      expect(q.threshold).toBe(0.5)
    })

    it('should quantize vectors', () => {
      const vector = randomVector(128)
      const binary = quantizer.quantize(vector)

      expect(binary).toBeInstanceOf(Uint8Array)
      expect(binary.length).toBe(128)
      expect(binary.every((b) => b === 0 || b === 1)).toBe(true)
    })

    it('should pack quantized vectors', () => {
      const vector = randomVector(128)
      const binary = quantizer.quantize(vector)
      const packed = quantizer.pack(binary)

      expect(packed).toBeInstanceOf(Uint8Array)
      expect(packed.length).toBe(16) // 128 / 8
    })

    it('should unpack to binary representation', () => {
      const vector = randomVector(128)
      const binary = quantizer.quantize(vector)
      const packed = quantizer.pack(binary)
      const unpacked = quantizer.unpack(packed)

      expect(unpacked).toEqual(binary)
    })

    it('should compute distance between quantized vectors', () => {
      const v1 = randomVector(128, 1)
      const v2 = randomVector(128, 2)

      const distance = quantizer.distance(v1, v2)

      expect(typeof distance).toBe('number')
      expect(distance).toBeGreaterThanOrEqual(0)
      expect(distance).toBeLessThanOrEqual(128)
    })

    it('should compute distance from packed representations', () => {
      const v1 = randomVector(128, 1)
      const v2 = randomVector(128, 2)

      const packed1 = quantizer.pack(quantizer.quantize(v1))
      const packed2 = quantizer.pack(quantizer.quantize(v2))

      const distance = quantizer.packedDistance(packed1, packed2)

      expect(typeof distance).toBe('number')
      expect(distance).toBeGreaterThanOrEqual(0)
      expect(distance).toBeLessThanOrEqual(128)
    })

    it('should validate vector dimensions', () => {
      const wrongDims = randomVector(64)

      expect(() => quantizer.quantize(wrongDims)).toThrow(/dimension/i)
    })

    it('should provide memory stats', () => {
      const stats = quantizer.getMemoryStats()

      expect(stats.bitsPerVector).toBe(128)
      expect(stats.bytesPerVector).toBe(16)
      expect(stats.compressionRatio).toBeCloseTo(32, 1)
    })
  })

  describe('Hamming distance on packed bytes', () => {
    it('should compute Hamming distance efficiently on packed Uint8Array', () => {
      const quantizer = new BinaryQuantizer({ dimensions: 128 })

      // Create two vectors
      const v1 = new Float32Array(128).fill(1) // All positive -> all 1s
      const v2 = new Float32Array(128).fill(-1) // All negative -> all 0s

      const packed1 = quantizer.pack(quantizer.quantize(v1))
      const packed2 = quantizer.pack(quantizer.quantize(v2))

      const distance = quantizer.packedDistance(packed1, packed2)

      expect(distance).toBe(128) // All bits different
    })

    it('should use popcount optimization for packed distance', () => {
      const quantizer = new BinaryQuantizer({ dimensions: 64 })

      // Create vectors where we know the exact difference
      const v1 = new Float32Array(64)
      const v2 = new Float32Array(64)

      // First 32 dimensions: same sign
      for (let i = 0; i < 32; i++) {
        v1[i] = 1
        v2[i] = 1
      }
      // Last 32 dimensions: opposite sign
      for (let i = 32; i < 64; i++) {
        v1[i] = 1
        v2[i] = -1
      }

      const packed1 = quantizer.pack(quantizer.quantize(v1))
      const packed2 = quantizer.pack(quantizer.quantize(v2))

      const distance = quantizer.packedDistance(packed1, packed2)

      expect(distance).toBe(32) // Only last 32 bits differ
    })
  })

  describe('Edge cases', () => {
    it('should handle empty vector', () => {
      const quantizer = new BinaryQuantizer({ dimensions: 0 })
      const vector = new Float32Array(0)

      const binary = quantizer.quantize(vector)
      const packed = quantizer.pack(binary)

      expect(binary.length).toBe(0)
      expect(packed.length).toBe(0)
    })

    it('should handle single dimension', () => {
      const quantizer = new BinaryQuantizer({ dimensions: 1 })
      const vector = new Float32Array([0.5])

      const binary = quantizer.quantize(vector)
      const packed = quantizer.pack(binary)

      expect(binary.length).toBe(1)
      expect(binary[0]).toBe(1)
      expect(packed.length).toBe(1)
    })

    it('should handle NaN values', () => {
      const quantizer = new BinaryQuantizer({ dimensions: 4 })
      const vector = new Float32Array([1, NaN, -1, 0])

      // NaN should be handled gracefully (treated as below threshold)
      expect(() => quantizer.quantize(vector)).not.toThrow()
      const binary = quantizer.quantize(vector)
      expect(binary[1]).toBe(0) // NaN treated as 0
    })

    it('should handle Infinity values', () => {
      const quantizer = new BinaryQuantizer({ dimensions: 4 })
      const vector = new Float32Array([Infinity, -Infinity, 1, -1])

      const binary = quantizer.quantize(vector)

      expect(binary[0]).toBe(1) // +Infinity >= 0
      expect(binary[1]).toBe(0) // -Infinity < 0
    })

    it('should handle very large vectors (10K dimensions)', () => {
      const dims = 10000
      const quantizer = new BinaryQuantizer({ dimensions: dims })
      const vector = randomVector(dims)

      const binary = quantizer.quantize(vector)
      const packed = quantizer.pack(binary)

      expect(binary.length).toBe(dims)
      expect(packed.length).toBe(1250) // 10000 / 8 = 1250 bytes
    })
  })
})
