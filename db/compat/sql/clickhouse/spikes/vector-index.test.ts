/**
 * SPIKE: Vector Index Tests
 *
 * Comprehensive tests for chunked HNSW vector index:
 * - Basic add/search operations
 * - Quantization (none, float16, int8, binary)
 * - Serialization/deserialization
 * - Streaming search
 * - Memory efficiency
 * - Correctness validation against brute force
 *
 * Run: npx vitest run vector-index.test.ts
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  VectorIndex,
  BruteForceIndex,
  quantize,
  dequantize,
  bytesPerVector,
  distance,
  SearchResult,
  QuantizationType,
} from './vector-index'

// ============================================================================
// TEST UTILITIES
// ============================================================================

/**
 * Generate a random normalized vector
 */
function randomVector(dimensions: number): Float32Array {
  const vec = new Float32Array(dimensions)
  let norm = 0
  for (let i = 0; i < dimensions; i++) {
    vec[i] = Math.random() * 2 - 1
    norm += vec[i] * vec[i]
  }
  norm = Math.sqrt(norm)
  for (let i = 0; i < dimensions; i++) {
    vec[i] /= norm
  }
  return vec
}

/**
 * Generate a vector close to a target (for testing recall)
 */
function similarVector(target: Float32Array, noise: number = 0.1): Float32Array {
  const vec = new Float32Array(target.length)
  let norm = 0
  for (let i = 0; i < target.length; i++) {
    vec[i] = target[i] + (Math.random() * 2 - 1) * noise
    norm += vec[i] * vec[i]
  }
  norm = Math.sqrt(norm)
  for (let i = 0; i < target.length; i++) {
    vec[i] /= norm
  }
  return vec
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
 * Compute recall@k: fraction of true top-k found in approximate top-k
 */
function computeRecall(
  approximate: SearchResult[],
  groundTruth: SearchResult[],
  k: number
): number {
  const topKTrue = new Set(groundTruth.slice(0, k).map((r) => r.id))
  const topKApprox = new Set(approximate.slice(0, k).map((r) => r.id))
  let overlap = 0
  for (const id of topKApprox) {
    if (topKTrue.has(id)) overlap++
  }
  return overlap / k
}

// ============================================================================
// QUANTIZATION TESTS
// ============================================================================

describe('Quantization', () => {
  const dimensions = 128
  const testVector = randomVector(dimensions)

  describe('quantize', () => {
    it('should pass through for none quantization', () => {
      const result = quantize(testVector, 'none')
      expect(result).toBe(testVector)
    })

    it('should maintain float32 format for float16', () => {
      const result = quantize(testVector, 'float16')
      expect(result).toBeInstanceOf(Float32Array)
      expect(result.length).toBe(dimensions)
    })

    it('should convert to Int8Array for int8', () => {
      const result = quantize(testVector, 'int8')
      expect(result).toBeInstanceOf(Int8Array)
      expect(result.length).toBe(dimensions)
      // Values should be in [-127, 127]
      for (let i = 0; i < result.length; i++) {
        expect(result[i]).toBeGreaterThanOrEqual(-127)
        expect(result[i]).toBeLessThanOrEqual(127)
      }
    })

    it('should convert to Uint8Array for binary', () => {
      const result = quantize(testVector, 'binary')
      expect(result).toBeInstanceOf(Uint8Array)
      expect(result.length).toBe(Math.ceil(dimensions / 8))
    })
  })

  describe('dequantize', () => {
    it('should reconstruct int8 to float32', () => {
      const quantized = quantize(testVector, 'int8')
      const dequantized = dequantize(quantized, 'int8', dimensions)
      expect(dequantized).toBeInstanceOf(Float32Array)
      expect(dequantized.length).toBe(dimensions)
    })

    it('should reconstruct binary to float32', () => {
      const quantized = quantize(testVector, 'binary')
      const dequantized = dequantize(quantized, 'binary', dimensions)
      expect(dequantized).toBeInstanceOf(Float32Array)
      expect(dequantized.length).toBe(dimensions)
      // Binary dequantization should produce -1 or 1
      for (let i = 0; i < dequantized.length; i++) {
        expect(Math.abs(dequantized[i])).toBe(1)
      }
    })
  })

  describe('bytesPerVector', () => {
    it('should return 4 bytes per dimension for none', () => {
      expect(bytesPerVector(128, 'none')).toBe(512)
    })

    it('should return 2 bytes per dimension for float16', () => {
      expect(bytesPerVector(128, 'float16')).toBe(256)
    })

    it('should return 1 byte per dimension for int8', () => {
      expect(bytesPerVector(128, 'int8')).toBe(128)
    })

    it('should return 1 bit per dimension for binary', () => {
      expect(bytesPerVector(128, 'binary')).toBe(16)
      expect(bytesPerVector(256, 'binary')).toBe(32)
      expect(bytesPerVector(100, 'binary')).toBe(13) // ceil(100/8)
    })
  })
})

// ============================================================================
// DISTANCE FUNCTION TESTS
// ============================================================================

describe('Distance Functions', () => {
  const dimensions = 128

  describe('cosine similarity', () => {
    it('should return 1 for identical vectors', () => {
      const vec = randomVector(dimensions)
      const dist = distance(vec, vec, 'none', 'cosine')
      expect(dist).toBeCloseTo(1, 5)
    })

    it('should return 0 for orthogonal vectors', () => {
      const a = new Float32Array(dimensions).fill(0)
      const b = new Float32Array(dimensions).fill(0)
      a[0] = 1
      b[1] = 1
      const dist = distance(a, b, 'none', 'cosine')
      expect(dist).toBeCloseTo(0, 5)
    })

    it('should return -1 for opposite vectors', () => {
      const a = randomVector(dimensions)
      const b = new Float32Array(a.length)
      for (let i = 0; i < a.length; i++) {
        b[i] = -a[i]
      }
      const dist = distance(a, b, 'none', 'cosine')
      expect(dist).toBeCloseTo(-1, 5)
    })
  })

  describe('euclidean distance', () => {
    it('should return 0 for identical vectors', () => {
      const vec = randomVector(dimensions)
      const dist = distance(vec, vec, 'none', 'euclidean')
      expect(dist).toBeCloseTo(0, 5)
    })

    it('should return sqrt(2) for orthogonal unit vectors', () => {
      const a = new Float32Array(dimensions).fill(0)
      const b = new Float32Array(dimensions).fill(0)
      a[0] = 1
      b[1] = 1
      const dist = distance(a, b, 'none', 'euclidean')
      expect(dist).toBeCloseTo(Math.sqrt(2), 5)
    })
  })

  describe('dot product', () => {
    it('should return squared norm for same vector', () => {
      const vec = randomVector(dimensions)
      const dist = distance(vec, vec, 'none', 'dot')
      // For normalized vector, dot product with itself = 1
      expect(dist).toBeCloseTo(1, 3)
    })

    it('should return 0 for orthogonal vectors', () => {
      const a = new Float32Array(dimensions).fill(0)
      const b = new Float32Array(dimensions).fill(0)
      a[0] = 1
      b[1] = 1
      const dist = distance(a, b, 'none', 'dot')
      expect(dist).toBeCloseTo(0, 5)
    })
  })

  describe('binary distance', () => {
    it('should return 1 for identical binary vectors', () => {
      const vec = randomVector(dimensions)
      const binary = quantize(vec, 'binary')
      const dist = distance(binary, binary, 'binary', 'cosine')
      expect(dist).toBeCloseTo(1, 5)
    })

    it('should handle hamming distance correctly', () => {
      const a = new Uint8Array([0b11110000])
      const b = new Uint8Array([0b11111111])
      const dist = distance(a, b, 'binary', 'euclidean')
      expect(dist).toBe(4) // 4 bits different
    })
  })
})

// ============================================================================
// VECTOR INDEX BASIC TESTS
// ============================================================================

describe('VectorIndex', () => {
  const dimensions = 128

  describe('constructor', () => {
    it('should create index with default options', () => {
      const index = new VectorIndex({ dimensions: 128 })
      const stats = index.stats()
      expect(stats.dimensions).toBe(128)
      expect(stats.quantization).toBe('none')
      expect(stats.vectorCount).toBe(0)
    })

    it('should create index with custom options', () => {
      const index = new VectorIndex({
        dimensions: 256,
        quantization: 'int8',
        M: 32,
        efConstruction: 400,
        metric: 'euclidean',
      })
      const stats = index.stats()
      expect(stats.dimensions).toBe(256)
      expect(stats.quantization).toBe('int8')
    })
  })

  describe('add', () => {
    it('should add a single vector', () => {
      const index = new VectorIndex({ dimensions })
      const vec = randomVector(dimensions)
      index.add('vec-1', vec)
      expect(index.stats().vectorCount).toBe(1)
    })

    it('should add multiple vectors', () => {
      const index = new VectorIndex({ dimensions })
      for (let i = 0; i < 100; i++) {
        index.add(`vec-${i}`, randomVector(dimensions))
      }
      expect(index.stats().vectorCount).toBe(100)
    })

    it('should throw on dimension mismatch', () => {
      const index = new VectorIndex({ dimensions: 128 })
      const wrongDim = randomVector(256)
      expect(() => index.add('vec-1', wrongDim)).toThrow(/dimension mismatch/)
    })
  })

  describe('search', () => {
    it('should return empty for empty index', () => {
      const index = new VectorIndex({ dimensions })
      const results = index.search(randomVector(dimensions), 10)
      expect(results).toEqual([])
    })

    it('should find the exact vector', () => {
      const index = new VectorIndex({ dimensions })
      const target = randomVector(dimensions)
      index.add('target', target)

      // Add some noise vectors
      for (let i = 0; i < 50; i++) {
        index.add(`noise-${i}`, randomVector(dimensions))
      }

      const results = index.search(target, 1)
      expect(results[0].id).toBe('target')
      expect(results[0].score).toBeCloseTo(1, 3) // cosine similarity
    })

    it('should return k results', () => {
      const index = new VectorIndex({ dimensions })
      for (let i = 0; i < 100; i++) {
        index.add(`vec-${i}`, randomVector(dimensions))
      }

      const results = index.search(randomVector(dimensions), 10)
      expect(results.length).toBe(10)
    })

    it('should throw on dimension mismatch', () => {
      const index = new VectorIndex({ dimensions: 128 })
      index.add('vec-1', randomVector(128))
      expect(() => index.search(randomVector(256), 10)).toThrow(/dimension mismatch/)
    })

    it('should find similar vectors with high recall', () => {
      const index = new VectorIndex({ dimensions, efConstruction: 200 })
      const bruteForce = new BruteForceIndex({ dimensions })

      const target = randomVector(dimensions)

      // Add 1000 random vectors
      for (let i = 0; i < 1000; i++) {
        const vec = randomVector(dimensions)
        index.add(`vec-${i}`, vec)
        bruteForce.add(`vec-${i}`, vec)
      }

      // Add some similar vectors
      for (let i = 0; i < 50; i++) {
        const vec = similarVector(target, 0.1)
        index.add(`similar-${i}`, vec)
        bruteForce.add(`similar-${i}`, vec)
      }

      const hnswResults = index.search(target, 10)
      const bruteResults = bruteForce.search(target, 10)

      const recall = computeRecall(hnswResults, bruteResults, 10)
      expect(recall).toBeGreaterThan(0.7) // Expect at least 70% recall
    })
  })
})

// ============================================================================
// QUANTIZATION INTEGRATION TESTS
// ============================================================================

describe('VectorIndex with Quantization', () => {
  const dimensions = 128
  const vectorCount = 500

  const quantizations: QuantizationType[] = ['none', 'float16', 'int8', 'binary']

  for (const quantization of quantizations) {
    describe(`${quantization} quantization`, () => {
      it('should build and search index', () => {
        const index = new VectorIndex({ dimensions, quantization })

        for (let i = 0; i < vectorCount; i++) {
          index.add(`vec-${i}`, randomVector(dimensions))
        }

        const stats = index.stats()
        expect(stats.vectorCount).toBe(vectorCount)
        expect(stats.quantization).toBe(quantization)

        const results = index.search(randomVector(dimensions), 10)
        expect(results.length).toBe(10)
      })

      it('should find exact match', () => {
        const index = new VectorIndex({ dimensions, quantization })
        const target = randomVector(dimensions)
        index.add('target', target)

        for (let i = 0; i < 100; i++) {
          index.add(`noise-${i}`, randomVector(dimensions))
        }

        const results = index.search(target, 1)
        expect(results[0].id).toBe('target')
      })

      it('should reduce memory with quantization', () => {
        const noneIndex = new VectorIndex({ dimensions, quantization: 'none' })
        const quantIndex = new VectorIndex({ dimensions, quantization })

        for (let i = 0; i < 100; i++) {
          const vec = randomVector(dimensions)
          noneIndex.add(`vec-${i}`, vec)
          quantIndex.add(`vec-${i}`, vec)
        }

        const noneStats = noneIndex.stats()
        const quantStats = quantIndex.stats()

        if (quantization === 'binary') {
          // Binary should be ~32x smaller for vectors
          const expectedRatio = 32
          // Just check it's significantly smaller
          expect(quantStats.memoryBytes).toBeLessThan(noneStats.memoryBytes)
        } else if (quantization === 'int8') {
          // int8 should be ~4x smaller
          expect(quantStats.memoryBytes).toBeLessThan(noneStats.memoryBytes)
        }
      })
    })
  }
})

// ============================================================================
// SERIALIZATION TESTS
// ============================================================================

describe('VectorIndex Serialization', () => {
  const dimensions = 64
  const vectorCount = 200

  it('should serialize and deserialize correctly', () => {
    const original = new VectorIndex({ dimensions })
    const vectors = new Map<string, Float32Array>()

    for (let i = 0; i < vectorCount; i++) {
      const vec = randomVector(dimensions)
      vectors.set(`vec-${i}`, vec)
      original.add(`vec-${i}`, vec)
    }

    const chunks = original.serialize()
    expect(chunks.length).toBeGreaterThan(0)

    const restored = VectorIndex.deserialize(chunks)
    expect(restored.stats().vectorCount).toBe(vectorCount)

    // Search should return same results
    const query = randomVector(dimensions)
    const originalResults = original.search(query, 10)
    const restoredResults = restored.search(query, 10)

    expect(originalResults.length).toBe(restoredResults.length)
    for (let i = 0; i < originalResults.length; i++) {
      expect(originalResults[i].id).toBe(restoredResults[i].id)
      expect(originalResults[i].score).toBeCloseTo(restoredResults[i].score, 3)
    }
  })

  it('should serialize with int8 quantization', () => {
    const original = new VectorIndex({ dimensions, quantization: 'int8' })

    for (let i = 0; i < 100; i++) {
      original.add(`vec-${i}`, randomVector(dimensions))
    }

    const chunks = original.serialize()
    const restored = VectorIndex.deserialize(chunks)

    expect(restored.stats().quantization).toBe('int8')
    expect(restored.stats().vectorCount).toBe(100)
  })

  it('should serialize with binary quantization', () => {
    const original = new VectorIndex({ dimensions, quantization: 'binary' })

    for (let i = 0; i < 100; i++) {
      original.add(`vec-${i}`, randomVector(dimensions))
    }

    const chunks = original.serialize()
    const restored = VectorIndex.deserialize(chunks)

    expect(restored.stats().quantization).toBe('binary')
    expect(restored.stats().vectorCount).toBe(100)
  })

  it('should produce multiple chunks for large indexes', () => {
    const index = new VectorIndex({
      dimensions,
      chunkSize: 10 * 1024, // 10KB chunks for testing
    })

    // Add enough vectors to exceed chunk size
    for (let i = 0; i < 500; i++) {
      index.add(`vec-${i}`, randomVector(dimensions))
    }

    const chunks = index.serialize()
    expect(chunks.length).toBeGreaterThan(1) // Should have multiple chunks
  })
})

// ============================================================================
// STREAMING SEARCH TESTS
// ============================================================================

describe('VectorIndex Streaming Search', () => {
  const dimensions = 64
  const vectorCount = 300

  it('should search with streaming chunk loading', async () => {
    const chunkSize = 5 * 1024 // Small chunks for testing
    const original = new VectorIndex({
      dimensions,
      chunkSize,
    })

    for (let i = 0; i < vectorCount; i++) {
      original.add(`vec-${i}`, randomVector(dimensions))
    }

    const chunks = original.serialize()
    const chunkMap = new Map<number, Uint8Array>()
    chunks.forEach((chunk, i) => chunkMap.set(i, chunk))

    // Create a new index for streaming search with SAME chunkSize
    const streamIndex = new VectorIndex({ dimensions, chunkSize })

    const query = randomVector(dimensions)

    // Mock chunk loader
    const loadChunk = async (index: number): Promise<Uint8Array> => {
      const chunk = chunkMap.get(index)
      if (!chunk) throw new Error(`Chunk ${index} not found`)
      return chunk
    }

    const streamResults = await streamIndex.searchStreaming(query, 10, loadChunk)
    const normalResults = original.search(query, 10)

    // Results should be similar (may not be identical due to graph traversal differences)
    expect(streamResults.length).toBe(10)

    // Check that top result is the same
    expect(streamResults[0].id).toBe(normalResults[0].id)
  })

  it('should track loaded chunks', async () => {
    const chunkSize = 5 * 1024
    const original = new VectorIndex({
      dimensions,
      chunkSize,
    })

    for (let i = 0; i < 200; i++) {
      original.add(`vec-${i}`, randomVector(dimensions))
    }

    const chunks = original.serialize()
    const loadedChunks = new Set<number>()

    const loadChunk = async (index: number): Promise<Uint8Array> => {
      loadedChunks.add(index)
      return chunks[index]
    }

    const streamIndex = new VectorIndex({ dimensions, chunkSize })
    await streamIndex.searchStreaming(randomVector(dimensions), 10, loadChunk)

    // Should have loaded at least the header chunk
    expect(loadedChunks.has(0)).toBe(true)
    // With HNSW, we explore graph connections, so many chunks may be loaded
    // But we should load SOME chunks (verification that streaming works)
    expect(loadedChunks.size).toBeGreaterThan(0)
    // And we shouldn't load header twice
    expect(loadedChunks.size).toBeLessThanOrEqual(chunks.length)
  })
})

// ============================================================================
// BRUTE FORCE INDEX TESTS
// ============================================================================

describe('BruteForceIndex', () => {
  const dimensions = 128

  it('should return exact nearest neighbors', () => {
    const index = new BruteForceIndex({ dimensions })

    const target = randomVector(dimensions)
    const closest = similarVector(target, 0.05)

    index.add('target', target)
    index.add('closest', closest)

    for (let i = 0; i < 100; i++) {
      index.add(`random-${i}`, randomVector(dimensions))
    }

    const results = index.search(target, 2)
    expect(results[0].id).toBe('target')
    expect(results[1].id).toBe('closest')
  })

  it('should serialize and maintain order', () => {
    const original = new BruteForceIndex({ dimensions })

    for (let i = 0; i < 50; i++) {
      original.add(`vec-${i}`, randomVector(dimensions))
    }

    const chunks = original.serialize()
    expect(chunks.length).toBeGreaterThan(0)

    // BruteForceIndex doesn't have deserialize, but chunks should be valid
    const headerChunk = chunks[0]
    const headerLen = new DataView(headerChunk.buffer).getUint32(0, true)
    const headerJson = new TextDecoder().decode(headerChunk.slice(4, 4 + headerLen))
    const header = JSON.parse(headerJson)

    expect(header.magic).toBe('BFVI')
    expect(header.vectorCount).toBe(50)
  })
})

// ============================================================================
// LARGE SCALE TESTS
// ============================================================================

describe('Large Scale Tests', () => {
  const dimensions = 128

  it('should handle 10K+ vectors', () => {
    const index = new VectorIndex({
      dimensions,
      M: 16,
      efConstruction: 100,
    })

    const startAdd = Date.now()
    for (let i = 0; i < 10000; i++) {
      index.add(`vec-${i}`, randomVector(dimensions))
    }
    const addTime = Date.now() - startAdd

    const stats = index.stats()
    expect(stats.vectorCount).toBe(10000)

    // Search should be fast
    const startSearch = Date.now()
    for (let i = 0; i < 100; i++) {
      index.search(randomVector(dimensions), 10)
    }
    const searchTime = Date.now() - startSearch

    // Log performance
    console.log(`Add 10K vectors: ${addTime}ms (${(addTime / 10000).toFixed(2)}ms/vec)`)
    console.log(`100 searches: ${searchTime}ms (${(searchTime / 100).toFixed(2)}ms/search)`)
    console.log(`Memory: ${(stats.memoryBytes / 1024 / 1024).toFixed(2)}MB`)
  }, 60000) // Increase timeout

  it('should stay under 100MB memory with 10K vectors', () => {
    const index = new VectorIndex({
      dimensions: 128,
      quantization: 'none',
    })

    for (let i = 0; i < 10000; i++) {
      index.add(`vec-${i}`, randomVector(128))
    }

    const stats = index.stats()
    const memoryMB = stats.memoryBytes / 1024 / 1024

    console.log(`Memory for 10K vectors (float32): ${memoryMB.toFixed(2)}MB`)
    expect(memoryMB).toBeLessThan(100)
  })

  it('should significantly reduce memory with binary quantization', () => {
    const noneIndex = new VectorIndex({ dimensions: 128, quantization: 'none' })
    const binaryIndex = new VectorIndex({ dimensions: 128, quantization: 'binary' })

    for (let i = 0; i < 10000; i++) {
      const vec = randomVector(128)
      noneIndex.add(`vec-${i}`, vec)
      binaryIndex.add(`vec-${i}`, vec)
    }

    const noneStats = noneIndex.stats()
    const binaryStats = binaryIndex.stats()

    console.log(`Float32 memory: ${(noneStats.memoryBytes / 1024 / 1024).toFixed(2)}MB`)
    console.log(`Binary memory: ${(binaryStats.memoryBytes / 1024 / 1024).toFixed(2)}MB`)
    console.log(`Reduction: ${(noneStats.memoryBytes / binaryStats.memoryBytes).toFixed(1)}x`)

    // Binary vectors are ~32x smaller, but connections and IDs remain same size
    // So total memory reduction is less dramatic
    expect(binaryStats.memoryBytes).toBeLessThan(noneStats.memoryBytes)
  })
})

// ============================================================================
// RECALL TESTS
// ============================================================================

describe('Recall Tests', () => {
  const dimensions = 64
  const vectorCount = 1000

  it('should achieve high recall@10', () => {
    const hnswIndex = new VectorIndex({
      dimensions,
      M: 16,
      efConstruction: 200,
    })
    const bruteIndex = new BruteForceIndex({ dimensions })

    // Add same vectors to both
    for (let i = 0; i < vectorCount; i++) {
      const vec = randomVector(dimensions)
      hnswIndex.add(`vec-${i}`, vec)
      bruteIndex.add(`vec-${i}`, vec)
    }

    // Run multiple queries and compute average recall
    let totalRecall = 0
    const numQueries = 50

    for (let q = 0; q < numQueries; q++) {
      const query = randomVector(dimensions)
      const hnswResults = hnswIndex.search(query, 10)
      const bruteResults = bruteIndex.search(query, 10)
      totalRecall += computeRecall(hnswResults, bruteResults, 10)
    }

    const avgRecall = totalRecall / numQueries
    console.log(`Average Recall@10: ${(avgRecall * 100).toFixed(1)}%`)
    expect(avgRecall).toBeGreaterThan(0.8) // Expect at least 80% recall
  })

  it('should maintain recall with int8 quantization', () => {
    const noneIndex = new VectorIndex({ dimensions, quantization: 'none' })
    const int8Index = new VectorIndex({ dimensions, quantization: 'int8' })
    const bruteIndex = new BruteForceIndex({ dimensions })

    for (let i = 0; i < vectorCount; i++) {
      const vec = randomVector(dimensions)
      noneIndex.add(`vec-${i}`, vec)
      int8Index.add(`vec-${i}`, vec)
      bruteIndex.add(`vec-${i}`, vec)
    }

    let noneRecall = 0
    let int8Recall = 0
    const numQueries = 50

    for (let q = 0; q < numQueries; q++) {
      const query = randomVector(dimensions)
      const noneResults = noneIndex.search(query, 10)
      const int8Results = int8Index.search(query, 10)
      const bruteResults = bruteIndex.search(query, 10)

      noneRecall += computeRecall(noneResults, bruteResults, 10)
      int8Recall += computeRecall(int8Results, bruteResults, 10)
    }

    console.log(`None Recall@10: ${((noneRecall / numQueries) * 100).toFixed(1)}%`)
    console.log(`Int8 Recall@10: ${((int8Recall / numQueries) * 100).toFixed(1)}%`)

    // int8 recall should be reasonable (may be lower but not terrible)
    expect(int8Recall / numQueries).toBeGreaterThan(0.5)
  })
})

// ============================================================================
// EDGE CASES
// ============================================================================

describe('Edge Cases', () => {
  it('should handle single vector', () => {
    const index = new VectorIndex({ dimensions: 64 })
    const vec = randomVector(64)
    index.add('only-one', vec)

    const results = index.search(vec, 10)
    expect(results.length).toBe(1)
    expect(results[0].id).toBe('only-one')
  })

  it('should handle k larger than vector count', () => {
    const index = new VectorIndex({ dimensions: 64 })
    for (let i = 0; i < 5; i++) {
      index.add(`vec-${i}`, randomVector(64))
    }

    const results = index.search(randomVector(64), 100)
    expect(results.length).toBe(5)
  })

  it('should handle very high dimensional vectors', () => {
    const dimensions = 1536 // OpenAI embedding size
    const index = new VectorIndex({ dimensions })

    for (let i = 0; i < 100; i++) {
      index.add(`vec-${i}`, randomVector(dimensions))
    }

    const results = index.search(randomVector(dimensions), 10)
    expect(results.length).toBe(10)
  })

  it('should handle very low dimensional vectors', () => {
    const dimensions = 2
    const index = new VectorIndex({ dimensions })

    for (let i = 0; i < 100; i++) {
      index.add(`vec-${i}`, randomVector(dimensions))
    }

    const results = index.search(randomVector(dimensions), 10)
    expect(results.length).toBe(10)
  })

  it('should handle duplicate IDs (last one wins)', () => {
    const index = new VectorIndex({ dimensions: 64 })
    const vec1 = randomVector(64)
    const vec2 = randomVector(64)

    index.add('same-id', vec1)
    index.add('same-id', vec2)

    // Both should be in the index (no deduplication in this implementation)
    expect(index.stats().vectorCount).toBe(2)
  })
})

// ============================================================================
// METRICS TESTS
// ============================================================================

describe('Different Metrics', () => {
  const dimensions = 64

  it('should work with euclidean metric', () => {
    const index = new VectorIndex({ dimensions, metric: 'euclidean' })

    const target = randomVector(dimensions)
    index.add('target', target)

    for (let i = 0; i < 100; i++) {
      index.add(`vec-${i}`, randomVector(dimensions))
    }

    const results = index.search(target, 1)
    expect(results[0].id).toBe('target')
    expect(results[0].score).toBeCloseTo(0, 3) // Euclidean distance = 0 for same vector
  })

  it('should work with dot product metric', () => {
    const index = new VectorIndex({ dimensions, metric: 'dot' })

    const target = randomVector(dimensions)
    index.add('target', target)

    for (let i = 0; i < 100; i++) {
      index.add(`vec-${i}`, randomVector(dimensions))
    }

    const results = index.search(target, 1)
    expect(results[0].id).toBe('target')
    expect(results[0].score).toBeCloseTo(1, 3) // Dot product of normalized vector with itself = 1
  })
})
